import { middleware } from '../tsx';
import { registerCustomDiff } from './../vdom';

const createFactory = middleware();

export const diff = createFactory(({ id }) => {
	return {
		register(diff: Function) {
			registerCustomDiff(id, diff);
		}
	};
});

export default diff;
