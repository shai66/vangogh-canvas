export type Fields = Record<string, unknown>;

export interface Logger {
	info(message: string, fields?: Fields): void;
	warn(message: string, fields?: Fields): void;
	error(message: string, fields?: Fields): void;
}

const SECRET = /password|token|authorization|secret/i;

function oneLine(text: string): string {
	return text.replace(/\s*[\r\n]+\s*/g, ' ');
}

function format(value: unknown): string {
	const text = oneLine(typeof value === 'string' ? value : JSON.stringify(value) ?? String(value));
	return /[\s"=]/.test(text) ? JSON.stringify(text) : text;
}

export function createLogger(write: (line: string) => void = console.log): Logger {
	const line = (level: string, message: string, fields: Fields = {}) => {
		const pairs = Object.entries(fields).map(
			([key, value]) => `${key}=${SECRET.test(key) ? '***' : format(value)}`
		);
		write([new Date().toISOString(), level, oneLine(message), ...pairs].join(' '));
	};
	return {
		info: (message, fields) => line('INFO', message, fields),
		warn: (message, fields) => line('WARN', message, fields),
		error: (message, fields) => line('ERROR', message, fields)
	};
}

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
