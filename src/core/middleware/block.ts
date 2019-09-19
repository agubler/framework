import global from '../../shim/global';
import { create, defer } from '../vdom';
import cache from './cache';
import icache from './icache';

const blockFactory = create({ defer, cache, icache });

export const block = blockFactory(({ middleware: { cache, icache, defer } }) => {
	let id = 1;
	return <T extends (...args: any[]) => any>(module: T) => {
		return (...args: Parameters<T>): (ReturnType<T> extends Promise<infer U> ? U : ReturnType<T>) | null => {
			const argsString = JSON.stringify(args);
			const moduleId = cache.get(module) || id++;
			cache.set(module, moduleId);
			const cachedValue = icache.getOrSet(`${moduleId}-${argsString}`, async () => {
				const run = module(...args);
				global.window.blocksPending = global.window.blocksPending ? global.window.blocksPending + 1 : 1;
				defer.pause();
				const result = await run;
				global.window.blocksPending--;
				defer.resume();
				return result;
			});
			return cachedValue || null;
		};
	};
});

export default block;
