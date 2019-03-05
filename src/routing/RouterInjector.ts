import { Registry } from '../widget-core/Registry';
import { RegistryLabel } from '../widget-core/interfaces';

import { Router } from './Router';
import { RouteConfig, RouterOptions } from './interfaces';

/**
 * Router Injector Options
 *
 */
export interface RouterInjectorOptions extends RouterOptions {
	key?: RegistryLabel;
}

/**
 * Creates a router instance for a specific History manager (default is `HashHistory`) and registers
 * the route configuration.
 *
 * @param config The route config to register for the router
 * @param registry An optional registry that defaults to the global registry
 * @param options The router injector options
 */
export function registerRouterInjector(config: Router, registry: Registry, options?: { key?: RegistryLabel }): Router;
export function registerRouterInjector(
	config: RouteConfig[],
	registry: Registry,
	options?: RouterInjectorOptions
): Router;
export function registerRouterInjector(
	routerOrConfig: RouteConfig[] | Router,
	registry: Registry,
	options: RouterInjectorOptions = {}
): Router {
	const { key = 'router', ...routerOptions } = options;
	let router: Router;
	if (routerOrConfig instanceof Router) {
		router = routerOrConfig;
	} else {
		router = new Router(routerOrConfig, routerOptions);
	}

	if (registry.hasInjector(key)) {
		throw new Error('Router has already been defined');
	}
	registry.defineInjector(key, (invalidator: () => void) => {
		router.on('nav', () => invalidator());
		return () => router;
	});
	return router;
}
