<script lang="ts">
	import type { TestLine, WakeLine } from '$lib/batocera';
	import { formatSize } from '$lib/format';
	import { isBoxAddress, isBoxUser, type BatoceraAnswer } from '$lib/settings';
	import { BATOCERA_URL, t } from '$lib/strings';
	import type { IconName } from './icons';
	import Icon from './Icon.svelte';

	type Part = Partial<Pick<BatoceraAnswer, 'on' | 'address' | 'user' | 'wake' | 'shutdown'>>;

	interface Props {
		/** Batocera's part of the settings as the sheet shows them, without the password. */
		batocera: BatoceraAnswer;
		/** What is typed into the password box; the saved password is never in the page. */
		password: string;
		/** A switch was pressed, or the address or the user was changed. */
		onchange: (part: Part) => void;
		/** The password box was left, or Enter pressed in it. */
		onpassword: () => void;
		/** A connection test ended: the sheet reads what it left, set up after a pass and not after a failure. */
		ontested: () => Promise<void>;
		/** The browser was locked meanwhile. */
		onlocked: () => void;
		/** Canvas refused a test: from another site, or the settings are off. */
		onrefused: () => void;
	}
	let { batocera, password = $bindable(), onchange, onpassword, ontested, onlocked, onrefused }: Props = $props();

	const check = t.settings.batoceraCheck;
	const wakeLine = t.settings.batoceraWakeLine;
	/** The longer of the two folders the test writes to: the room of line 3 before it fails. */
	const ROOM_FOLDER = '/userdata/roms/windows';
	/** A network card of the length of any: the room of the last line while no card is known. */
	const ROOM_MAC = '00:00:00:00:00:00';
	const JSON_HEADERS = { 'content-type': 'application/json' };

	/** What a line shows: its kind, its icon, and every text it can come to, so that its room is that of the longest. */
	interface LineView {
		kind: 'todo' | 'ok' | 'bad' | 'warn';
		icon: IconName;
		turning: boolean;
		texts: string[];
		on: number;
	}

	type Box = 'address' | 'user';
	/** What is in the address and user boxes. */
	// svelte-ignore state_referenced_locally
	let boxes = $state({ address: batocera.address, user: batocera.user });
	/** What the sheet showed when the boxes last took it. */
	// svelte-ignore state_referenced_locally
	const took = { address: batocera.address, user: batocera.user };
	// A change put back, or the login a passed test saved, comes into the boxes; otherwise what is typed stays.
	$effect.pre(() => {
		for (const box of ['address', 'user'] as const) {
			if (batocera[box] !== took[box]) boxes[box] = took[box] = batocera[box];
		}
	});
	let addressBox: HTMLInputElement;
	let userBox: HTMLInputElement;
	/** A text box that holds what Canvas cannot take: it is not saved, and waits to be mended. */
	let invalid = $state({ address: false, user: false });

	// ---------- The connection test (spec 0.12.0, section 9.3) ----------

	type StepLine = Exclude<TestLine, { done: true }>;
	/** The lines of the test, by step; null while a line waits. */
	let steps = $state<(StepLine | null)[]>([null, null, null, null, null]);
	/** The step being checked, from 1 to 5. */
	let running = $state<number | null>(null);
	/** The address the test was made with. */
	let tested = $state<string | null>(null);
	/** The box's network card, read and saved by a test that passed. */
	let mac = $state<string | null>(null);
	let testing = false;
	/** The number of the test the lines belong to: a change of the login ends what they say. */
	let run = 0;

	/** The texts of a line, before, passed, and failed or warned. */
	function textsOf(i: number, step: StepLine | null, address: string): string[] {
		const before = check.before[i];
		switch (i) {
			case 0:
				return [before, check.answers(address), check.noAnswer(address)];
			case 1:
				return [before, check.login, check.refused, check.noSsh];
			case 2:
				return [before, check.writes, check.cannotWrite(step?.folder ?? ROOM_FOLDER, step?.reason ?? null), check.noInnoextract];
			case 3:
				return [before, step?.free !== undefined && step.version ? check.space(formatSize(step.free), step.version) : before, check.noSpace];
			default:
				return [before, check.es, check.noEs];
		}
	}

	const lines = $derived(
		steps.map((step, i): LineView => {
			const texts = textsOf(i, step, tested ?? batocera.address);
			if (step === null) return { kind: 'todo', icon: running === i + 1 ? 'spinner' : 'pending', turning: running === i + 1, texts, on: 0 };
			if (step.result === 'ok') return { kind: 'ok', icon: 'ok', turning: false, texts, on: 1 };
			if (step.result === 'warn') return { kind: 'warn', icon: 'warning', turning: false, texts, on: 2 };
			return { kind: 'bad', icon: 'fail', turning: false, texts, on: step.login === 'no-ssh' || step.noInnoextract ? 3 : 2 };
		})
	);

	/** The address, the user or the password changed: the lines speak of the login before, so they wait for a test again. */
	function forget() {
		run++;
		steps = [null, null, null, null, null];
		running = null;
		tested = null;
		mac = null;
	}

	/** The JSON lines of a test's answer, one by one as they come. The rest of the answer is left when the caller stops. */
	async function* jsonLines<T>(body: ReadableStream<Uint8Array>): AsyncGenerator<T> {
		const reader = body.getReader();
		const decoder = new TextDecoder();
		let rest = '';
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) return;
				rest += decoder.decode(value, { stream: true });
				for (let end = rest.indexOf('\n'); end >= 0; end = rest.indexOf('\n')) {
					const text = rest.slice(0, end);
					rest = rest.slice(end + 1);
					if (text.trim() !== '') yield JSON.parse(text) as T;
				}
			}
		} finally {
			// After a passed test the server still looks at the box: the page does not wait for it.
			reader.cancel().catch(() => {});
		}
	}

	/** Starts a test's request; null when Canvas did not take it, which the sheet then says. */
	async function start(path: string, body: unknown): Promise<ReadableStream<Uint8Array> | null> {
		const res = await fetch(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
		if (res.status === 401) onlocked();
		else if (res.status === 403 || res.status === 404) onrefused();
		return res.ok ? res.body : null;
	}

	/** "Test connection": with what is in the three boxes, saved or not; the password only when one is typed. */
	async function testConnection() {
		if (testing) return;
		const address = boxes.address.trim();
		const user = boxes.user.trim();
		invalid = { address: address === '' || !isBoxAddress(address), user: !isBoxUser(user) };
		if (invalid.address || invalid.user) {
			(invalid.address ? addressBox : userBox).focus();
			return;
		}
		forget();
		const id = run;
		testing = true;
		tested = address;
		running = 1;
		try {
			const body = await start('/api/settings/batocera/test', { address, user, ...(password === '' ? {} : { password }) });
			if (!body) return;
			for await (const line of jsonLines<TestLine>(body)) {
				// The login changed while the test ran: its lines speak of the one before.
				if (id !== run) break;
				if ('done' in line) {
					if (line.ready) mac = line.mac;
					await ontested();
					break;
				}
				steps[line.step - 1] = line;
				running = line.result === 'fail' || line.step === 5 ? null : line.step + 1;
			}
		} catch {
			// No answer, or it broke off: the line under way waits again.
		} finally {
			testing = false;
			if (id === run) running = null;
		}
	}

	// ---------- The wake test (spec 0.12.0, section 9.5) ----------

	type WakeState = 'before' | 'down' | 'waking' | 'woke' | 'noAnswer' | 'busy' | 'notDown';
	let wake = $state<WakeState>('before');
	let wokeAfter = $state(0);
	let waking = false;

	const WAKE_ORDER: WakeState[] = ['before', 'down', 'waking', 'woke', 'noAnswer', 'busy', 'notDown'];
	const wakeView = $derived.by((): LineView => {
		const texts = [wakeLine.before, wakeLine.down, wakeLine.waking, wakeLine.woke(wokeAfter), wakeLine.noAnswer, wakeLine.busy, wakeLine.notDown];
		const on = WAKE_ORDER.indexOf(wake);
		if (wake === 'down' || wake === 'waking') return { kind: 'todo', icon: 'spinner', turning: true, texts, on };
		if (wake === 'woke') return { kind: 'ok', icon: 'ok', turning: false, texts, on };
		if (wake === 'busy') return { kind: 'warn', icon: 'warning', turning: false, texts, on };
		if (wake === 'before') return { kind: 'todo', icon: 'pending', turning: false, texts, on };
		return { kind: 'bad', icon: 'fail', turning: false, texts, on };
	});

	/** "Test wake": Canvas shuts the box down and wakes it, a line as each step ends. */
	async function testWake() {
		if (waking) return;
		waking = true;
		wake = 'down';
		try {
			const body = await start('/api/settings/batocera/test-wake', {});
			if (!body) return;
			for await (const line of jsonLines<WakeLine>(body)) {
				if ('done' in line) {
					if (wake === 'waking' && line.seconds !== null) {
						wokeAfter = line.seconds;
						wake = 'woke';
					}
					break;
				}
				if (line.step === 'down') wake = line.result === 'ok' ? 'waking' : line.result === 'busy' ? 'busy' : 'notDown';
				else if (line.result !== 'ok') wake = 'noAnswer';
			}
		} catch {
			// No answer, or it broke off: the line waits again.
		} finally {
			waking = false;
			if (wake === 'down' || wake === 'waking') wake = 'before';
		}
	}

	// ---------- The text boxes (spec 0.12.0, section 9.2) ----------

	/** A box left, or Enter pressed: saved if it changed and Canvas can take it. */
	function commit(box: Box) {
		const value = (boxes[box] = boxes[box].trim());
		const valid = box === 'address' ? isBoxAddress(value) : isBoxUser(value);
		invalid[box] = !valid;
		if (!valid || value === batocera[box]) return;
		forget();
		onchange({ [box]: value });
	}

	function commitPassword() {
		if (password === '') return;
		forget();
		onpassword();
	}

	const enter = (then: () => void) => (event: KeyboardEvent) => event.key === 'Enter' && then();
</script>

{#snippet line(view: LineView)}
	<li class="is-{view.kind}">
		<span class="bato-icon" class:is-turning={view.turning}><Icon name={view.icon} /></span>
		<span class="stack">
			{#each view.texts as text, i (i)}
				<span class:on={i === view.on} aria-hidden={i !== view.on}>{text}</span>
			{/each}
		</span>
	</li>
{/snippet}

<section class="settings-panel bato-settings">
	<h2 class="section-title">{t.settings.batocera} <span class="set-tag">{t.settings.batoceraTag}</span> <span>{t.settings.batoceraNote}</span></h2>
	<div class="set-switch-row">
		<div>
			<span class="set-switch-label" id="set-bato">{t.settings.batoceraSwitch}</span>
			<p class="set-switch-text">
				{t.settings.batoceraText}
				<a href={BATOCERA_URL} target="_blank" rel="noreferrer">{t.settings.batoceraLink}<Icon name="external" /></a>
			</p>
			<p class="set-switch-text set-experimental">{t.settings.batoceraExperimental}</p>
		</div>
		<button class="switch" type="button" role="switch" aria-checked={batocera.on} aria-labelledby="set-bato" onclick={() => onchange({ on: !batocera.on })}>
			<span class="knob"></span>
		</button>
	</div>
	<!-- While Batocera is off the rows stay where they are, dimmed and not usable, so switching moves nothing. -->
	<div class="set-row" class:is-off={!batocera.on} inert={!batocera.on}>
		<label class="set-k" for="bato-address">{t.settings.batoceraAddress}</label>
		<div class="set-field">
			<input
				class="set-input"
				id="bato-address"
				type="text"
				inputmode="url"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				maxlength={253}
				aria-invalid={invalid.address ? 'true' : undefined}
				bind:value={boxes.address}
				bind:this={addressBox}
				oninput={() => (invalid.address = false)}
				onchange={() => commit('address')}
				onkeydown={enter(() => commit('address'))}
			/>
			<span class="set-hint">{t.settings.batoceraAddressHint}</span>
		</div>
	</div>
	<div class="set-row" class:is-off={!batocera.on} inert={!batocera.on}>
		<label class="set-k" for="bato-user">{t.settings.batoceraUser}</label>
		<div class="set-field">
			<input
				class="set-input"
				id="bato-user"
				type="text"
				autocomplete="off"
				autocapitalize="none"
				spellcheck="false"
				maxlength={32}
				aria-invalid={invalid.user ? 'true' : undefined}
				bind:value={boxes.user}
				bind:this={userBox}
				oninput={() => (invalid.user = false)}
				onchange={() => commit('user')}
				onkeydown={enter(() => commit('user'))}
			/>
		</div>
	</div>
	<div class="set-row" class:is-off={!batocera.on} inert={!batocera.on}>
		<label class="set-k" for="bato-password">{t.settings.batoceraPassword}</label>
		<div class="set-field">
			<!-- Never filled by the server: what is typed goes with the next save, and the box is emptied once it is saved. -->
			<input
				class="set-input"
				id="bato-password"
				type="password"
				autocomplete="new-password"
				maxlength={128}
				placeholder={t.settings.batoceraPasswordSaved}
				bind:value={password}
				onchange={commitPassword}
				onkeydown={enter(commitPassword)}
			/>
			<span class="set-hint">{#each t.settings.batoceraPasswordHint as part, i (i)}{part.plain}{#if part.bold}<b>{part.bold}</b>{/if}{/each}</span>
		</div>
	</div>
	<div class="set-row" class:is-off={!batocera.on} inert={!batocera.on}>
		<span class="set-k set-k-button">{t.settings.batoceraConnection}</span>
		<div class="set-field">
			<button class="btn btn-small" type="button" onclick={testConnection}><Icon name="plug" />{t.settings.batoceraTest}</button>
			<!-- The lines are there before a test, and a test fills them in place. -->
			<ul class="set-checks set-connection" aria-live="polite">
				{#each lines as view, i (i)}
					{@render line(view)}
				{/each}
				<li class="check-mac" class:is-hidden={mac === null}>{check.mac(mac ?? batocera.mac ?? ROOM_MAC)}</li>
			</ul>
		</div>
	</div>
	<div class="set-switch-row" class:is-off={!batocera.on} inert={!batocera.on}>
		<div>
			<span class="set-switch-label" id="set-wake">{t.settings.batoceraWake}</span>
			<p class="set-switch-text">{t.settings.batoceraWakeText}</p>
			<div class="set-act">
				<!-- Usable once a test saved the box's network card. -->
				<button class="btn btn-small" type="button" disabled={batocera.mac === null} onclick={testWake}><Icon name="power" />{t.settings.batoceraTestWake}</button>
				<ul class="set-checks set-wake" aria-live="polite">
					{@render line(wakeView)}
				</ul>
			</div>
		</div>
		<button class="switch" type="button" role="switch" aria-checked={batocera.wake} aria-labelledby="set-wake" onclick={() => onchange({ wake: !batocera.wake })}>
			<span class="knob"></span>
		</button>
	</div>
	<div class="set-switch-row" class:is-off={!batocera.on} inert={!batocera.on}>
		<div>
			<span class="set-switch-label" id="set-shutdown">{t.settings.batoceraShutdown}</span>
			<p class="set-switch-text">{t.settings.batoceraShutdownText}</p>
		</div>
		<button class="switch" type="button" role="switch" aria-checked={batocera.shutdown} aria-labelledby="set-shutdown" onclick={() => onchange({ shutdown: !batocera.shutdown })}>
			<span class="knob"></span>
		</button>
	</div>
</section>
