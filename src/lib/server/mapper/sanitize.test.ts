import { describe, expect, it } from 'vitest';
import { sanitizeDescription } from './sanitize';

describe('sanitizeDescription', () => {
	it('keeps basic formatting', () => {
		const html = '<h2>Title</h2><p>A <b>bold</b> and <em>soft</em> word.<br>Next</p><ul><li>One</li></ul>';
		expect(sanitizeDescription(html)).toBe(
			'<h2>Title</h2><p>A <b>bold</b> and <em>soft</em> word.<br />Next</p><ul><li>One</li></ul>'
		);
	});

	it('removes scripts together with their content', () => {
		expect(sanitizeDescription('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
		expect(sanitizeDescription('<style>p{color:red}</style><p>Hi</p>')).toBe('<p>Hi</p>');
	});

	it('removes images, frames and event attributes', () => {
		const html = '<p onclick="x()">Hi<img src="a.jpg" onerror="x()"><iframe src="//x"></iframe></p>';
		expect(sanitizeDescription(html)).toBe('<p>Hi</p>');
	});

	it('removes style and class attributes', () => {
		expect(sanitizeDescription('<p style="color:red" class="x">Hi</p>')).toBe('<p>Hi</p>');
	});

	it('opens links in a new tab', () => {
		expect(sanitizeDescription('<a href="https://gog.com">GOG</a>')).toBe(
			'<a href="https://gog.com" target="_blank" rel="noopener noreferrer">GOG</a>'
		);
	});

	it('drops the address of a link that is not http or https', () => {
		const out = sanitizeDescription('<a href="javascript:alert(1)">x</a>');
		expect(out).not.toContain('javascript');
		expect(out).toContain('x');
	});

	it.each([
		['/api/rebuild'],
		['foo.html'],
		['#x'],
		['//evil.example/x'],
		['jav&#x09;ascript:x'],
		['data:text/html,x'],
		[' JaVaScRiPt:x'],
		['http:/api/rebuild'],
		['https:x']
	])('drops the address %j of a link and keeps its text', (href) => {
		const out = sanitizeDescription(`<p><a href="${href}">the text</a></p>`);
		expect(out).not.toContain('href');
		expect(out).toContain('the text');
	});

	it('keeps an absolute http address', () => {
		expect(sanitizeDescription('<a href="http://example.com/a?b=1">x</a>')).toContain(
			'href="http://example.com/a?b=1"'
		);
	});

	it('gives an empty text for nothing', () => {
		expect(sanitizeDescription(null)).toBe('');
		expect(sanitizeDescription(undefined)).toBe('');
		expect(sanitizeDescription('   ')).toBe('');
	});
});
