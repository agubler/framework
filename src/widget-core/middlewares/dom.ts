import { middleware } from '../tsx';
import { getNodeById } from '../vdom';

const createFactory = middleware();

export const dom = createFactory(({ id, invalidator }) => {
	return {
		get(key: any): HTMLElement | null {
			const blah = getNodeById(id, key, () => {
				invalidator();
			});
			return blah;
		}
	};
});

export default dom;
