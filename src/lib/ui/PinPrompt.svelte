<script lang="ts">
	import { tick } from 'svelte';
	import type { SettingsAnswer } from '$lib/settings';
	import { t } from '$lib/strings';
	import Icon from './Icon.svelte';

	interface Props {
		/** True when the settings were locked while their sheet was open: the prompt says so. */
		again: boolean;
		/** The right PIN: the settings, as the server tells them to an unlocked browser. */
		onunlocked: (answer: SettingsAnswer) => void;
		onclose: () => void;
	}
	let { again, onunlocked, onclose }: Props = $props();

	let pin = $state('');
	/** What went wrong with the last try: a wrong PIN, no answer, or Canvas refused the request. */
	let problem = $state<'wrong' | 'failed' | 'refused' | null>(null);
	let waiting = $state(false);
	let field: HTMLInputElement;

	// A body of JSON: SvelteKit refuses a form's or a text's body from the page before Canvas reads it.
	const asJson = { 'content-type': 'application/json' };

	/** Canvas answered and refused: a request from another site (403), or the settings are off (404). */
	const refused = (status: number) => status === 403 || status === 404;

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		if (waiting) return;
		waiting = true;
		try {
			const res = await fetch('/api/settings/unlock', { method: 'POST', headers: asJson, body: JSON.stringify({ pin }) });
			if (res.status === 204) {
				const settings = await fetch('/api/settings');
				if (settings.ok) {
					onunlocked((await settings.json()) as SettingsAnswer);
					return;
				}
				problem = refused(settings.status) ? 'refused' : 'failed';
			} else {
				problem = res.status === 401 ? 'wrong' : refused(res.status) ? 'refused' : 'failed';
			}
		} catch {
			problem = 'failed';
		} finally {
			waiting = false;
		}
		if (problem) {
			// The field has the focus again, also after a click on the button. After a wrong PIN the next try types over it.
			await tick();
			field.focus();
			if (problem === 'wrong') field.select();
		}
	}
</script>

<div class="pin-inner">
	<div class="detail-close-holder">
		<button class="detail-close" type="button" onclick={onclose}>
			<Icon name="close" /><span class="sr">{t.detail.close}</span>
		</button>
	</div>
	<span class="pin-badge"><Icon name="lock" /></span>
	<h1 class="pin-title">{t.pin.title}</h1>
	<p class="pin-text">{again ? t.pin.again : t.pin.text}</p>
	<form class="pin-form" onsubmit={submit}>
		<!-- svelte-ignore a11y_autofocus -->
		<input
			bind:this={field}
			bind:value={pin}
			class="pin-field"
			class:is-wrong={problem === 'wrong'}
			type="password"
			inputmode="numeric"
			autocomplete="off"
			maxlength="10"
			aria-label={t.pin.field}
			aria-invalid={problem === 'wrong'}
			autofocus
			oninput={() => (problem = null)}
		/>
		<!-- The line keeps its height while empty, so a message moves nothing. -->
		<p class="pin-error" role="alert">{problem === 'wrong' ? t.pin.wrong : problem === 'failed' ? t.pin.failed : problem === 'refused' ? t.pin.refused : ''}</p>
		<button class="btn btn-primary pin-unlock" type="submit" disabled={waiting}>{t.pin.unlock}</button>
	</form>
	<p class="pin-hint">{t.pin.hint}</p>
</div>
