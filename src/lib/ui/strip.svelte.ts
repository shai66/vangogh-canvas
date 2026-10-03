/**
 * A row that scrolls sideways without a scrollbar, with an arrow at each end. Each arrow is
 * hidden at its own end, and both when the row fits. The screenshots and a collection's row of
 * posters use it.
 */
export class Strip {
	node = $state<HTMLElement>();
	atStart = $state(true);
	atEnd = $state(false);

	measure = (): void => {
		const node = this.node;
		if (!node) return;
		this.atStart = node.scrollLeft < 8;
		this.atEnd = node.scrollLeft + node.clientWidth > node.scrollWidth - 8;
	};

	move = (direction: number): void => {
		this.node?.scrollBy({ left: direction * this.node.clientWidth * 0.8, behavior: 'smooth' });
	};
}
