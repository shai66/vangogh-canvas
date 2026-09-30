import sanitizeHtml from 'sanitize-html';

/**
 * True for an address that leads away from Canvas: absolute, http or https.
 * `http:/x` counts as relative in a browser, so the two slashes are required.
 */
function isAbsoluteHttp(href: string | undefined): href is string {
	if (!href || !/^https?:\/\/[^\s/]/i.test(href) || /[\u0000-\u001f\u007f]/.test(href)) return false;
	try {
		const url = new URL(href);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/**
 * GOG's descriptions are HTML. Keeps paragraphs, headings, lists, emphasis,
 * links and line breaks, and removes everything else. Spec section 4.
 */
export function sanitizeDescription(html: string | null | undefined): string {
	if (!html) return '';
	return sanitizeHtml(html, {
		allowedTags: [
			'p', 'br',
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
			'ul', 'ol', 'li',
			'b', 'strong', 'i', 'em',
			'a'
		],
		allowedAttributes: { a: ['href', 'target', 'rel'] },
		allowedSchemes: ['http', 'https'],
		allowProtocolRelative: false,
		disallowedTagsMode: 'discard',
		transformTags: {
			// A link into Canvas itself, like /api/rebuild, loses its address; the text stays.
			a: (_tag, { href }) => ({
				tagName: 'a',
				attribs: {
					...(isAbsoluteHttp(href) ? { href } : {}),
					target: '_blank',
					rel: 'noopener noreferrer'
				}
			})
		}
	}).trim();
}
