import { middleware } from '../tsx';
import test from './test';
import cache from './cache';

const createFactory = middleware();

export const testOne = createFactory({ test, cache }, ({ middleware, properties }) => {
	return {
		get(): string {
			console.log(properties);
			console.log(middleware.cache.get());
			middleware.cache.set('foo');
			console.log(middleware.cache.get());
			return `${middleware.test.get()}testOne`;
		}
	};
});

export default testOne;
