/** One zone of the world's database for each offset, with a few major cities, by winter offset. */
export const ZONES: readonly { zone: string; cities: string }[] = [
	{ zone: 'Pacific/Pago_Pago', cities: 'Pago Pago, Niue' },
	{ zone: 'Pacific/Honolulu', cities: 'Honolulu' },
	{ zone: 'America/Anchorage', cities: 'Anchorage' },
	{ zone: 'America/Los_Angeles', cities: 'Los Angeles, San Francisco, Seattle, Vancouver' },
	{ zone: 'America/Denver', cities: 'Denver, Calgary, Phoenix, Salt Lake City' },
	{ zone: 'America/Chicago', cities: 'Chicago, Dallas, Houston, Mexico City' },
	{ zone: 'America/New_York', cities: 'New York, Bogotá, Lima, Miami, Toronto' },
	{ zone: 'America/Halifax', cities: 'Halifax, Caracas, Santiago' },
	{ zone: 'America/St_Johns', cities: "St. John's" },
	{ zone: 'America/Sao_Paulo', cities: 'São Paulo, Buenos Aires' },
	{ zone: 'America/Noronha', cities: 'Fernando de Noronha' },
	{ zone: 'Atlantic/Azores', cities: 'Azores' },
	{ zone: 'Europe/London', cities: 'London, Dublin, Lisbon, Reykjavík' },
	{ zone: 'Europe/Berlin', cities: 'Amsterdam, Berlin, Bratislava, Lagos, Paris, Prague, Rome, Vienna' },
	{ zone: 'Europe/Athens', cities: 'Athens, Bucharest, Cairo, Helsinki, Johannesburg, Kyiv' },
	{ zone: 'Europe/Istanbul', cities: 'Istanbul, Moscow, Nairobi, Riyadh' },
	{ zone: 'Asia/Tehran', cities: 'Tehran' },
	{ zone: 'Asia/Dubai', cities: 'Dubai, Baku, Tbilisi' },
	{ zone: 'Asia/Kabul', cities: 'Kabul' },
	{ zone: 'Asia/Karachi', cities: 'Karachi, Tashkent' },
	{ zone: 'Asia/Kolkata', cities: 'Delhi, Mumbai, Colombo' },
	{ zone: 'Asia/Kathmandu', cities: 'Kathmandu' },
	{ zone: 'Asia/Dhaka', cities: 'Dhaka, Almaty' },
	{ zone: 'Asia/Yangon', cities: 'Yangon' },
	{ zone: 'Asia/Bangkok', cities: 'Bangkok, Hanoi, Jakarta' },
	{ zone: 'Asia/Shanghai', cities: 'Beijing, Hong Kong, Singapore, Perth' },
	{ zone: 'Asia/Tokyo', cities: 'Tokyo, Seoul' },
	{ zone: 'Australia/Adelaide', cities: 'Adelaide, Darwin' },
	{ zone: 'Australia/Sydney', cities: 'Sydney, Brisbane, Melbourne' },
	{ zone: 'Pacific/Noumea', cities: 'Nouméa, Honiara' },
	{ zone: 'Pacific/Auckland', cities: 'Auckland, Wellington' },
	{ zone: 'Pacific/Tongatapu', cities: 'Nukuʻalofa, Apia' },
	{ zone: 'Pacific/Kiritimati', cities: 'Kiritimati' }
];

/** The offset of a zone at a moment, in minutes, read from Intl. */
function offsetMinutes(zone: string, at: Date): number {
	const name =
		new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
			.formatToParts(at)
			.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT';
	const match = /([+−-])(\d{1,2})(?::(\d{2}))?$/.exec(name);
	if (!match) return 0;
	const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
	return match[1] === '+' ? minutes : -minutes;
}

function label(minutes: number): string {
	if (minutes === 0) return 'UTC';
	const abs = Math.abs(minutes);
	const mins = abs % 60;
	return `UTC${minutes < 0 ? '−' : '+'}${Math.floor(abs / 60)}${mins ? `:${String(mins).padStart(2, '0')}` : ''}`;
}

/** "UTC+1", "UTC+5:30", "UTC−3:30" (a real minus), or "UTC" for none. */
export function offsetLabel(zone: string, at: Date): string {
	return label(offsetMinutes(zone, at));
}

function winterMinutes(zone: string, year: number): number {
	return Math.min(
		offsetMinutes(zone, new Date(Date.UTC(year, 0, 15, 12))),
		offsetMinutes(zone, new Date(Date.UTC(year, 6, 15, 12)))
	);
}

/** The smaller of the offsets on 15 January and 15 July, so a southern winter counts too. */
export function winterOffset(zone: string, year: number): string {
	return label(winterMinutes(zone, year));
}

/** True when both zones have the same offsets on 15 January and 15 July. */
export function sameClocks(a: string, b: string, year: number): boolean {
	return [0, 6].every((month) => {
		const at = new Date(Date.UTC(year, month, 15, 12));
		return offsetMinutes(a, at) === offsetMinutes(b, at);
	});
}

/**
 * The 33 entries as options, "UTC+1 · Amsterdam, Berlin, …". A current zone, or one to keep
 * (the stack's), that is not listed and has the clocks of no entry gets an option of its own by its offset.
 */
export function zoneOptions(current: string, at: Date, keep: readonly string[] = []): { value: string; label: string }[] {
	const year = at.getUTCFullYear();
	const options = ZONES.map(({ zone, cities }) => ({
		value: zone,
		label: `${winterOffset(zone, year)} · ${cities}`,
		minutes: winterMinutes(zone, year)
	}));
	for (const zone of [current, ...keep]) {
		if (selectedZone(zone, year) !== zone || options.some((o) => o.value === zone)) continue;
		const minutes = winterMinutes(zone, year);
		const name = (zone.split('/').pop() ?? zone).replace(/_/g, ' ');
		const entry = { value: zone, label: `${label(minutes)} · ${name}`, minutes };
		const after = options.findIndex((o) => o.minutes > minutes);
		options.splice(after === -1 ? options.length : after, 0, entry);
	}
	return options.map(({ value, label }) => ({ value, label }));
}

/** The listed zone to show for the current one: itself, else the entry with its clocks, else itself. */
export function selectedZone(current: string, year: number): string {
	if (ZONES.some((z) => z.zone === current)) return current;
	return ZONES.find((z) => sameClocks(z.zone, current, year))?.zone ?? current;
}

/** Whether the zone has summer time this year, and its offset at the given moment. */
export function nowLine(zone: string, at: Date): { summer: boolean; offset: string } {
	const year = at.getUTCFullYear();
	const jan = offsetMinutes(zone, new Date(Date.UTC(year, 0, 15, 12)));
	const jul = offsetMinutes(zone, new Date(Date.UTC(year, 6, 15, 12)));
	return { summer: jan !== jul, offset: offsetLabel(zone, at) };
}
