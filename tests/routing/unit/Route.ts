const { beforeEach, describe, it } = intern.getInterface('bdd');
const { assert } = intern.getPlugin('chai');

import { WidgetBase } from '../../../src/core/WidgetBase';
import { MemoryHistory as HistoryManager } from '../../../src/routing/history/MemoryHistory';
import { Route } from '../../../src/routing/Route';
import { Registry } from '../../../src/core/Registry';
import { registerRouterInjector } from '../../../src/routing/RouterInjector';
import { w, create, getRegistry } from '../../../src/core/vdom';
import harness from '../../../src/testing/harness';

class Widget extends WidgetBase {
	render() {
		return 'widget';
	}
}

let registry: Registry;

const routeConfig = [
	{
		path: '/foo',
		outlet: 'foo',
		id: 'foo',
		children: [
			{
				path: '/bar',
				outlet: 'bar',
				id: 'bar'
			}
		]
	},
	{
		path: 'baz/{baz}',
		id: 'baz',
		outlet: 'baz'
	}
];

const factory = create();

const mockGetRegistry = factory(() => {
	return () => {
		return registry;
	};
});

describe('Route', () => {
	beforeEach(() => {
		registry = new Registry();
	});

	it('Should render the result of the renderer when the Route matches', () => {
		const router = registerRouterInjector(routeConfig, registry, { HistoryManager });

		router.setPath('/foo');
		const h = harness(
			() =>
				w(Route, {
					id: 'foo',
					renderer() {
						return w(Widget, {});
					}
				}),
			{ middleware: [[getRegistry, mockGetRegistry]] }
		);
		h.expect(() => w(Widget, {}, []));
	});

	it('Should set the type as index for exact matches', () => {
		let matchType: string | undefined;
		const router = registerRouterInjector(routeConfig, registry, { HistoryManager });
		router.setPath('/foo');
		const h = harness(
			() =>
				w(Route, {
					id: 'foo',
					renderer(details: any) {
						matchType = details.type;
						return null;
					}
				}),
			{ middleware: [[getRegistry, mockGetRegistry]] }
		);
		h.expect(() => null);
		assert.strictEqual(matchType, 'index');
	});

	it('Should set the type as error for error matches', () => {
		let matchType: string | undefined;
		const router = registerRouterInjector(routeConfig, registry, { HistoryManager });
		router.setPath('/foo/other');
		const h = harness(
			() =>
				w(Route, {
					id: 'foo',
					renderer(details: any) {
						matchType = details.type;
						return null;
					}
				}),
			{ middleware: [[getRegistry, mockGetRegistry]] }
		);
		h.expect(() => null);
		assert.strictEqual(matchType, 'error');
	});

	it('Should render nothing when if no router is available', () => {
		const routeConfig = [
			{
				path: '/foo',
				outlet: 'foo',
				id: 'foo'
			}
		];

		const router = registerRouterInjector(routeConfig, registry, { HistoryManager });
		router.setPath('/other');
		const h = harness(
			() =>
				w(Route, {
					id: 'foo',
					renderer(details: any) {
						if (details.type === 'index') {
							return w(Widget, {});
						}
					}
				}),
			{ middleware: [[getRegistry, mockGetRegistry]] }
		);
		h.expect(() => null);
	});
});
