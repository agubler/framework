import { middleware } from '../tsx';
import { getRegistry } from './../vdom';

const createFactory = middleware();

export const injector = createFactory(({ id, invalidator }) => {
	const registry = getRegistry(id);
	const registeredInjectorsMap = new Map<string, any>();
	return {
		get<T = any>(name: string): T | null {
			if (!registry) {
				return null;
			}
			const item = registry.getInjector(name);
			if (item) {
				if (!registeredInjectorsMap.has(id)) {
					const handle = item.invalidator.on('invalidate', () => {
						invalidator();
					});
					registeredInjectorsMap.set(id, handle);
				}
				return item.injector() as T;
			}
			return null;
		}
	};
});

export default injector;
