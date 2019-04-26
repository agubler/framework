import { middleware } from '../tsx';
import cache from './cache';

const createFactory = middleware();

export const test = createFactory({ cache }, ({ middleware }) => {
	return {
		get(): string {
			console.log(middleware.cache.get());
			middleware.cache.set('blah');
			console.log(middleware.cache.get());
			return 'test';
		}
	};
});

export default test;
