import { describe, expect, it } from 'vitest';
import { detailsJson, listId, plainText, type ListDetails } from './gamelist';

const harbour: ListDetails = {
	name: 'Night Harbour',
	description: 'A quiet port.\n\nTen "harbours" & a <light>.',
	releaseYear: 1999,
	developers: ['Tidewater Works', 'Second Works'],
	publisher: 'Lantern Press',
	genres: ['Adventure', 'Puzzle']
};

describe('detailsJson', () => {
	it("writes the game's details as EmulationStation takes them, string values only", () => {
		expect(JSON.parse(detailsJson(harbour))).toEqual({
			name: 'Night Harbour',
			desc: 'A quiet port.\n\nTen "harbours" & a <light>.',
			releasedate: '19990101T000000',
			developer: 'Tidewater Works, Second Works',
			publisher: 'Lantern Press',
			genre: 'Adventure, Puzzle'
		});
	});

	it('leaves out what it does not know', () => {
		expect(JSON.parse(detailsJson({ ...harbour, description: '', releaseYear: null, developers: [], publisher: '', genres: [] }))).toEqual({ name: 'Night Harbour' });
	});
});

describe('listId', () => {
	it("is the MD5 of the game's whole path, as EmulationStation names its games", () => {
		expect(listId('/userdata/roms/windows/Night Harbour.pc')).toBe('9df9dce506cfc4eb603451d8b1ae412d');
		expect(listId('/userdata/roms/dos/Cellar Quest® Deluxe.pc')).toBe('5554c88512b040cc243ede4672ba5738');
	});
});

describe('plainText', () => {
	it('turns the description into plain text', () => {
		expect(plainText('<p>One &amp; two</p><p>Three<br>four</p>')).toBe('One & two\n\nThree\nfour');
		expect(plainText('<b>a</b>&nbsp;b &lt;c&gt; &quot;d&quot; &apos;e&apos;')).toBe('a b <c> "d" \'e\'');
	});

	it('keeps the line breaks of headings and lists', () => {
		const html = '<h4>Features</h4><ul><li>Ten harbours</li><li>A lighthouse</li></ul><p>It won&#39;t stop &mdash; ever.</p>';
		expect(plainText(html)).toBe("Features\n\n- Ten harbours\n- A lighthouse\n\nIt won't stop \u2014 ever.");
		expect(plainText('&#x41;&#66;')).toBe('AB');
		expect(plainText('<p>a &#99999999; b &#xD800; c</p>')).toBe('a &#99999999; b &#xD800; c');
		expect(plainText('&#' + '9'.repeat(400) + ';')).toBe('&#' + '9'.repeat(400) + ';');
	});
});
