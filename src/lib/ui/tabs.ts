/** Where an arrow key, Home or End moves in a row of `count` tabs from the tab at `at`: the next index, or -1 for another key. */
export function nextTab(key: string, count: number, at: number): number {
	if (count === 0) return -1;
	switch (key) {
		case 'ArrowRight':
			return (at + 1) % count;
		case 'ArrowLeft':
			return (at - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return -1;
	}
}
