const { afterEach, beforeEach, describe, it } = intern.getInterface('bdd');
const { assert } = intern.getPlugin('chai');
const { describe: jsdomDescribe } = intern.getPlugin('jsdom');
import global from '../../../src/shim/global';
import { from as arrayFrom } from '../../../src/shim/array';
import { spy, stub, createSandbox, SinonSpy, SinonStub, SinonSandbox } from 'sinon';
import { add } from '../../../src/core/has';
import { createResolvers } from './../support/util';
import sendEvent from '../support/sendEvent';
import {
	create,
	renderer,
	diffProperty,
	defer,
	destroy,
	getRegistry,
	invalidator,
	node,
	v,
	w,
	dom as d,
	tsx,
	setRendering,
	incrementBlockCount,
	decrementBlockCount
} from '../../../src/core/vdom';
import { VNode, DomVNode, RenderResult, WidgetBaseConstructor } from '../../../src/core/interfaces';
import Registry from '../../../src/core/Registry';
import { I18nMixin } from '../../../src/class-based/core/mixins/I18n';
import { ThemedMixin } from '../../../src/class-based/core/mixins/Themed';
import icache from '../../../src/core/middleware/icache';

const resolvers = createResolvers();

let consoleWarnStub: SinonStub;

jsdomDescribe('vdom', () => {
	const spys: SinonSpy[] = [];

	beforeEach(() => {
		resolvers.stub();
		add('dojo-debug', true, true);
		consoleWarnStub = stub(console, 'warn');
	});

	afterEach(() => {
		resolvers.restore();
		for (let spy of spys) {
			spy.restore();
		}
		spys.length = 0;
		consoleWarnStub.restore();
	});

	describe('widgets', () => {
		it('children', () => {
			const createWidget = create({ invalidator });

			let text = 'first';
			let updateText: any;

			const Foo = createWidget(({ children }) => children());
			const App = createWidget(({ middleware }) => {
				updateText = () => {
					text = 'second';
					middleware.invalidator();
				};
				return v('div', [Foo({}, [text])]);
			});
			const r = renderer(() => App({}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>first</div></div>');
			updateText();
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>second</div></div>');
		});

		it('Should render nodes in the correct order with mix of vnode and wnodes', () => {
			const createWidget = create();

			const WidgetOne = createWidget(() => WidgetTwo({}));
			const WidgetTwo = createWidget(() => v('div', ['dom2']));
			const WidgetThree = createWidget(() => ['dom3', 'dom3a']);
			const WidgetFour = createWidget(() => WidgetFive({}));
			const WidgetFive = createWidget(() => WidgetSix({}));
			const WidgetSix = createWidget(() => 'dom5');
			const App = createWidget(() => ['dom1', WidgetOne({}), WidgetThree({}), 'dom4', WidgetFour({}), 'dom6']);

			const r = renderer(() => App({}));
			const root: any = document.createElement('div');
			r.mount({ domNode: root });
			assert.strictEqual(root.childNodes[0].data, 'dom1');
			assert.strictEqual(root.childNodes[1].childNodes[0].data, 'dom2');
			assert.strictEqual(root.childNodes[2].data, 'dom3');
			assert.strictEqual(root.childNodes[3].data, 'dom3a');
			assert.strictEqual(root.childNodes[4].data, 'dom4');
			assert.strictEqual(root.childNodes[5].data, 'dom5');
			assert.strictEqual(root.childNodes[6].data, 'dom6');
		});

		it('Re-renders widget based on property changes', () => {
			let label = 'default';
			const createWidget = create({ invalidator });
			const Foo = createWidget.properties<{ label: string; other: boolean }>()(
				({ properties }) => properties().label
			);
			const App = createWidget.properties()(({ middleware }) => {
				const setLabel = () => {
					label = 'custom';
					middleware.invalidator();
				};
				return v('div', [v('button', { onclick: setLabel }, ['Set']), Foo({ other: true, label })]);
			});
			const root = document.createElement('div');
			const r = renderer(() => App({}));
			r.mount({ domNode: root });
			assert.strictEqual(root.outerHTML, '<div><div><button>Set</button>default</div></div>');
			const button = root.childNodes[0].childNodes[0] as HTMLButtonElement;
			sendEvent(button, 'click');
			resolvers.resolve();
			assert.strictEqual(root.outerHTML, '<div><div><button>Set</button>custom</div></div>');
			sendEvent(button, 'click');
			resolvers.resolve();
			assert.strictEqual(root.outerHTML, '<div><div><button>Set</button>custom</div></div>');
		});

		it('supports widget registry items', () => {
			const registry = new Registry();
			const createWidget = create();
			const Foo = createWidget.properties<{ text: string }>()(({ properties }) => v('h1', [properties().text]));
			const Bar = createWidget.properties<{ text: string }>()(({ properties }) => v('h1', [properties().text]));

			registry.define('foo', Foo);
			registry.define('bar', Bar);
			const Baz = createWidget(() => v('div', [w('foo', { text: 'foo' }), w('bar', { text: 'bar' })]));

			const r = renderer(() => Baz({}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true, registry });
			const root = div.childNodes[0];
			const headerOne = root.childNodes[0];
			const headerOneText = headerOne.childNodes[0] as Text;
			const headerTwo = root.childNodes[1];
			const headerTwoText = headerTwo.childNodes[0] as Text;
			assert.strictEqual(headerOneText.data, 'foo');
			assert.strictEqual(headerTwoText.data, 'bar');
		});

		it('support top level registry items', () => {
			const createWidget = create();
			const registry = new Registry();
			const Foo = createWidget(() => 'Top Level Registry');

			let resolver: any;
			const promise = new Promise<any>((resolve) => {
				resolver = resolve;
			});

			const r = renderer(() =>
				w(
					{
						label: 'foo',
						registryItem: () => {
							return promise;
						}
					},
					{}
				)
			);
			const div = document.createElement('div');
			r.mount({ domNode: div, registry, sync: true });
			resolver(Foo);
			assert.strictEqual(div.outerHTML, '<div></div>');
			return promise.then(() => {
				assert.strictEqual(div.outerHTML, '<div>Top Level Registry</div>');
			});
		});

		it('Should pause rendering while merging to allow lazily loaded widgets to be loaded', () => {
			const createWidget = create();
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(`<div><span>54321</span><span>98765</span><span>12345</span></div>`);
			iframe.contentDocument!.close();

			const root = iframe.contentDocument!.body.firstChild as HTMLElement;
			const lazyFooSpan = root.childNodes[0] as HTMLSpanElement;
			const lazyBarSpan = root.childNodes[1] as HTMLSpanElement;
			const span = root.childNodes[2] as HTMLSpanElement;
			const registry = new Registry();

			const Bar = createWidget(() => v('span', ['98765']));

			let barResolver: any;
			const barPromise = new Promise<any>((resolve) => {
				barResolver = resolve;
			});

			const Foo = createWidget(() => [
				v('span', ['54321']),
				w({ label: 'bar', registryItem: () => barPromise }, {})
			]);

			let fooResolver: any;
			const fooPromise = new Promise<any>((resolve) => {
				fooResolver = resolve;
			});

			const App = createWidget(() =>
				v('div', [
					w(
						{
							label: 'foo',
							registryItem: () => fooPromise
						},
						{}
					),
					v('span', ['12345'])
				])
			);

			const r = renderer(() => App({}));
			r.mount({ registry, domNode: iframe.contentDocument!.body, sync: true });
			fooResolver(Foo);
			return fooPromise.then(() => {
				assert.strictEqual(root.childNodes[2], span);
				assert.strictEqual(root.childNodes[1], lazyBarSpan);
				assert.strictEqual(root.childNodes[0], lazyFooSpan);
				barResolver(Bar);
				return barPromise.then(() => {
					assert.strictEqual(root.childNodes[2], span);
					assert.strictEqual(root.childNodes[1], lazyBarSpan);
					assert.strictEqual(root.childNodes[0], lazyFooSpan);
				});
			});
		});

		it('should clone properties', () => {
			const factory = create().properties<{ count: number }>();
			const Foo = factory(function Foo({ properties }) {
				return <div>{`${properties().count}`}</div>;
			});
			const properties: any = { count: 0 };
			const App = create({ invalidator })(function App({ middleware: { invalidator } }) {
				return (
					<div>
						<button
							onclick={() => {
								invalidator();
							}}
						/>
						{w(Foo, properties)}
					</div>
				);
			});
			const root = document.createElement('div');
			const r = renderer(() => App({}));
			r.mount({ domNode: root });
			assert.strictEqual(root.innerHTML, '<div><button></button><div>0</div></div>');
			properties.count = 1;
			(root.children[0].children[0] as any).click();
			resolvers.resolveRAF();
			assert.strictEqual(root.innerHTML, '<div><button></button><div>1</div></div>');
		});

		it('registry items', () => {
			const createWidget = create();
			let resolver = () => {};
			const registry = new Registry();
			const Widget = createWidget(() => v('div', ['Hello, world!']));
			const RegistryWidget = createWidget(() => v('div', ['Registry, world!']));
			const promise = new Promise<any>((resolve) => {
				resolver = () => {
					resolve(RegistryWidget);
				};
			});
			registry.define('registry-item', promise);
			const App = createWidget(() => [w('registry-item', {}), w(Widget, {})]);
			const r = renderer(() => App({}));
			const root = document.createElement('div');
			r.mount({ domNode: root, sync: true, registry });
			assert.lengthOf(root.childNodes, 1);
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, 'Hello, world!');
			resolver();
			return promise.then(() => {
				assert.lengthOf(root.childNodes, 2);
				assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, 'Registry, world!');
				assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, 'Hello, world!');
			});
		});

		it('removes existing widget and uses new widget when widget changes', () => {
			const createWidget = create({ invalidator });

			let visible = true;
			let swap: any;

			const Foo = createWidget.properties<{ text: string }>()(({ properties }) => properties().text);
			const Bar = createWidget.properties<{ text: string }>()(({ properties }) => properties().text);
			const App = createWidget(({ middleware }) => {
				swap = () => {
					visible = !visible;
					middleware.invalidator();
				};
				return v('div', [
					visible ? Foo({ text: 'foo' }) : Bar({ text: 'bar' }),
					visible ? Bar({ key: '1', text: 'bar1' }) : Bar({ key: '2', text: 'bar2' })
				]);
			});
			const r = renderer(() => App({}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>foobar1</div></div>');
			swap();
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>barbar2</div></div>');
		});

		it('Should warn when adding nodes that are not distinguishable', () => {
			const createWidget = create({ invalidator });

			let visible = true;
			let swap: any;

			const App = createWidget(function App({ middleware }) {
				swap = () => {
					visible = !visible;
					middleware.invalidator();
				};
				return v('div', [v('div'), visible && v('div'), v('div')]);
			});
			const r = renderer(() => App({}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			assert.isTrue(consoleWarnStub.notCalled);
			swap();
			resolvers.resolve();
			assert.isTrue(consoleWarnStub.calledOnce);
		});

		it('Should warn when adding widgets that are not distinguishable', () => {
			const createWidget = create({ invalidator });

			let visible = true;
			let swap: any;

			const Foo = createWidget(function Foo() {
				return v('div');
			});

			const App = createWidget(function App({ middleware }) {
				swap = () => {
					visible = !visible;
					middleware.invalidator();
				};
				return v('div', [w(Foo, {}), visible && w(Foo, {}), w(Foo, {})]);
			});
			const r = renderer(() => App({}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			assert.isTrue(consoleWarnStub.notCalled);
			swap();
			resolvers.resolve();
			assert.isTrue(consoleWarnStub.calledOnce);
		});

		it('typed children', () => {
			const factory = create({ node }).children<(value: string) => RenderResult>();
			const Foo = factory(function Foo({ children }) {
				const [c] = children();
				if (c) {
					return c('result');
				}
			});
			const r = renderer(() => Foo({}, [(foo) => v('div', [foo])]));
			const root = document.createElement('div');
			r.mount({ domNode: root });
			resolvers.resolve();
			assert.strictEqual(root.outerHTML, '<div><div>result</div></div>');
		});

		it('typed children and properties', () => {
			const factory = create({ node })
				.properties<{ foo: string }>()
				.children<(value: string) => RenderResult>();
			const Foo = factory(function Foo({ children, properties }) {
				const [c] = children();
				const { foo } = properties();
				if (c) {
					return c(foo);
				}
				return foo;
			});
			const r = renderer(() =>
				v('div', [
					w(Foo, { foo: '1' }, [(foo) => foo]),
					Foo({ foo: 'foo' }, [(foo) => v('div', [foo])]),
					Foo({ foo: 'foo' }, [() => ''])
				])
			);
			const root = document.createElement('div');
			r.mount({ domNode: root });
			resolvers.resolve();
			assert.strictEqual(root.outerHTML, '<div><div>1<div>foo</div></div></div>');
		});

		it('properties should have a live binding', () => {
			const factory = create({ icache }).properties<any>();

			const RunnerWidget = factory(({ properties, middleware: { icache } }) => {
				return (
					<div>
						<button
							onclick={() => {
								const { doSomething } = properties();
								icache.set('value', doSomething());
							}}
						>
							Click me
						</button>
						<div>{icache.getOrSet('value', '')}</div>
					</div>
				);
			});

			const MyWidget = factory(({ properties }) => {
				return (
					<RunnerWidget
						doSomething={() => {
							return properties().value;
						}}
					/>
				);
			});

			const App = factory(function App({ middleware: { icache } }) {
				const value = icache.getOrSet('value', '1');
				return (
					<div>
						<button
							onclick={() => {
								icache.set('value', `${value}1`);
							}}
						>
							Increment Value
						</button>
						<MyWidget value={value} />
					</div>
				);
			});

			const root = document.createElement('div');
			const r = renderer(() => <App />);
			r.mount({ domNode: root });
			(root as any).children[0].children[0].click();
			resolvers.resolve();
			(root as any).children[0].children[1].children[0].click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<div><div><button>Increment Value</button><div><button>Click me</button><div>11</div></div></div></div>'
			);
			(root as any).children[0].children[0].click();
			resolvers.resolve();
			(root as any).children[0].children[0].click();
			resolvers.resolve();
			(root as any).children[0].children[0].click();
			resolvers.resolve();
			(root as any).children[0].children[0].click();
			resolvers.resolve();
			(root as any).children[0].children[1].children[0].click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<div><div><button>Increment Value</button><div><button>Click me</button><div>111111</div></div></div></div>'
			);
		});

		it('should use key as widget key', () => {
			const middlewareFactory = create({ icache })
				.properties<{ bar: string | number }>()
				.key('bar');

			const mid = middlewareFactory(({ middleware: { icache } }) => {
				return () => {
					let result = icache.getOrSet('num', 1);
					icache.set('num', result + 1);
					return result;
				};
			});

			const factory = create({ mid, icache })
				.properties<{ foo: string | number }>()
				.key('foo');

			const AutomaticKey = factory(function AutomaticKey({ properties, middleware: { icache, mid } }) {
				let result = icache.getOrSet('num', 1);
				icache.set('num', result + 1);
				return (
					<div>
						{properties().key}
						{properties().foo}
						{properties().bar}
						{`widget-state-${result}`}
						{`middleware-state-${mid()}`}
					</div>
				);
			});
			const AutomaticCompositeKey = factory(function AutomaticKey({ properties, middleware: { icache, mid } }) {
				let result = icache.getOrSet('num', 1);
				icache.set('num', result + 1);
				return (
					<div>
						{properties().key}
						{properties().foo}
						{properties().bar}
						{`widget-state-${result}`}
						{`middleware-state-${mid()}`}
					</div>
				);
			});
			const AutomaticNumberKey = factory(function AutomaticKey({ properties, middleware: { icache, mid } }) {
				let result = icache.getOrSet('num', 1);
				icache.set('num', result + 1);
				return (
					<div>
						{properties().key}
						{`${properties().foo}`}
						{`${properties().bar}`}
						{`widget-state-${result}`}
						{`middleware-state-${mid()}`}
					</div>
				);
			});
			const AutomaticCompositeNumberKey = factory(function AutomaticKey({
				properties,
				middleware: { icache, mid }
			}) {
				let result = icache.getOrSet('num', 1);
				icache.set('num', result + 1);
				return (
					<div>
						{`${properties().key}`}
						{`${properties().foo}`}
						{`${properties().bar}`}
						{`widget-state-${result}`}
						{`middleware-state-${mid()}`}
					</div>
				);
			});
			const AutomaticKeyMiddlewareOnly = create({ mid, icache })(function AutomaticKeyMiddlewareOnly({
				properties,
				middleware: { icache, mid }
			}) {
				let result = icache.getOrSet('num', 1);
				icache.set('num', result + 1);
				return (
					<div>
						{properties().key}
						{`${properties().bar}`}
						{`widget-state-${result}`}
						{`middleware-state-${mid()}`}
					</div>
				);
			});

			const App = create({ icache })(function App({ middleware: { icache } }) {
				const stringKey = icache.getOrSet('string-key', 'property-foo');
				const numKey = icache.getOrSet('number-key', 4321);
				return (
					<div>
						<AutomaticKey foo={stringKey} bar="property-bar" />
						<AutomaticCompositeKey key="user-key" foo={stringKey} bar="property-bar" />
						<AutomaticNumberKey foo={9999} bar={numKey} />
						<AutomaticCompositeNumberKey foo={9999} key={1234} bar={numKey} />
						<AutomaticKeyMiddlewareOnly bar={stringKey} />
						<button
							onclick={() => {
								icache.set('string-key', 'property-new-foo');
								icache.set('number-key', 43214321);
							}}
						/>
					</div>
				);
			});
			const root = document.createElement('root');
			const r = renderer(() => <App />);
			r.mount({ domNode: root });
			assert.strictEqual(
				root.outerHTML,
				'<root><div><div>property-fooproperty-barwidget-state-1middleware-state-1</div><div>user-keyproperty-fooproperty-barwidget-state-1middleware-state-1</div><div>99994321widget-state-1middleware-state-1</div><div>123499994321widget-state-1middleware-state-1</div><div>property-foowidget-state-1middleware-state-1</div><button></button></div></root>'
			);
			(root.children[0].children[5] as HTMLButtonElement).click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<root><div><div>property-new-fooproperty-barwidget-state-1middleware-state-1</div><div>user-keyproperty-new-fooproperty-barwidget-state-1middleware-state-1</div><div>999943214321widget-state-1middleware-state-1</div><div>1234999943214321widget-state-1middleware-state-1</div><div>property-new-foowidget-state-1middleware-state-1</div><button></button></div></root>'
			);
		});

		it('should only render widget once during a scheduled render', () => {
			const Widget = create({ icache }).properties<{
				start: number;
				onStart(value: number): void;
			}>()(function Widget({ properties, middleware: { icache } }) {
				const { start } = properties();
				if (start !== undefined && start !== icache.get('start')) {
					icache.set('start', start);
					icache.set('currentStart', start);
				}

				const currentStart = icache.getOrSet('currentStart', 1);

				const nodes = [<div key="prev">p</div>];
				for (let i = currentStart; i < 10; i++) {
					nodes.push(<button key={`page-${i}`}>{`${i}`}</button>);
				}
				nodes.push(<div key="next">n</div>);

				return (
					<div>
						<button
							key="button1"
							onclick={() => {
								const start = Math.min(icache.getOrSet('currentStart', 1) + 4, 10);
								properties().onStart(start);
								icache.set('currentStart', start);
							}}
						>
							plus
						</button>
						<button
							key="button2"
							onclick={() => {
								const start = Math.max(icache.getOrSet('currentStart', 1) - 4, 1);
								properties().onStart(start);
								icache.set('currentStart', start);
							}}
						>
							minus
						</button>
						{nodes}
					</div>
				);
			});

			const App = create({ icache })(function App({ middleware: { icache } }) {
				const start = icache.getOrSet('start', 5);

				return (
					<Widget
						start={start}
						onStart={(value) => {
							icache.set('start', value);
						}}
					/>
				);
			});

			const root = document.createElement('root');
			const r = renderer(() => <App />);
			r.mount({ domNode: root });
			assert.strictEqual(
				root.innerHTML,
				'<div><button>plus</button><button>minus</button><div>p</div><button>5</button><button>6</button><button>7</button><button>8</button><button>9</button><div>n</div></div>'
			);
			(root.children[0].children[1] as any).click();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><button>plus</button><button>minus</button><div>p</div><button>1</button><button>2</button><button>3</button><button>4</button><button>5</button><button>6</button><button>7</button><button>8</button><button>9</button><div>n</div></div>'
			);
		});

		it('should create live binding to the latest version of function properties', () => {
			const factory = create({ icache }).properties<any>();

			const FunctionChild = create({ icache }).properties<{
				onChange: (value: number) => void;
			}>()(function FunctionChild({ properties, middleware: { icache } }) {
				const renderCount = icache.getOrSet('r', 1, false);
				icache.set('r', renderCount + 1, false);
				const { onChange } = properties();
				return (
					<div>
						<button onclick={() => onChange(1)} />
						<div>{`Child Rendered: ${renderCount}`}</div>
					</div>
				);
			});

			const FunctionBased = create({ icache }).properties<{ multiplier: number; A: WidgetBaseConstructor }>()(
				function FunctionBased({ properties, middleware: { icache } }) {
					const { multiplier, A } = properties();
					const result = icache.getOrSet('n', 1);
					const renderCount = icache.getOrSet('r', 1);
					icache.set('r', renderCount + 1);
					const PropertyWidget = A.unwrap();
					return (
						<div>
							<FunctionChild
								onChange={() => {
									icache.set('n', result * multiplier);
								}}
							/>
							<div>{`result: ${result}`}</div>
							<div>{`Parent Rendered: ${renderCount}`}</div>
							<PropertyWidget>Class</PropertyWidget>
						</div>
					);
				}
			);

			class ClassBased extends WidgetBase {
				private _counter = 0;
				render() {
					return (
						<div>
							{this.children}
							{`${this._counter++}`}
						</div>
					);
				}
			}

			const App = factory(function App({ middleware: { icache } }) {
				const multiplier = icache.getOrSet('m', 2);
				return (
					<div>
						<button
							onclick={() => {
								icache.set('m', multiplier + 1);
							}}
						>
							Multiplier++
						</button>
						<div>{`Multiplier: ${multiplier}`}</div>
						<FunctionBased multiplier={multiplier} A={ClassBased} />
					</div>
				);
			});
			const root = document.createElement('root');
			const r = renderer(() => <App />);
			r.mount({ domNode: root });

			assert.strictEqual(
				root.outerHTML,
				'<root><div><button>Multiplier++</button><div>Multiplier: 2</div><div><div><button></button><div>Child Rendered: 1</div></div><div>result: 1</div><div>Parent Rendered: 1</div><div>Class0</div></div></div></root>'
			);
			(root.children[0].children[0] as HTMLButtonElement).click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<root><div><button>Multiplier++</button><div>Multiplier: 3</div><div><div><button></button><div>Child Rendered: 1</div></div><div>result: 1</div><div>Parent Rendered: 2</div><div>Class1</div></div></div></root>'
			);
			(root.children[0].children[2].children[0].children[0] as HTMLButtonElement).click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<root><div><button>Multiplier++</button><div>Multiplier: 3</div><div><div><button></button><div>Child Rendered: 1</div></div><div>result: 3</div><div>Parent Rendered: 3</div><div>Class2</div></div></div></root>'
			);
			(root.children[0].children[2].children[0].children[0] as HTMLButtonElement).click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<root><div><button>Multiplier++</button><div>Multiplier: 3</div><div><div><button></button><div>Child Rendered: 1</div></div><div>result: 9</div><div>Parent Rendered: 4</div><div>Class3</div></div></div></root>'
			);
			(root.children[0].children[2].children[0].children[0] as HTMLButtonElement).click();
			resolvers.resolve();
			assert.strictEqual(
				root.outerHTML,
				'<root><div><button>Multiplier++</button><div>Multiplier: 3</div><div><div><button></button><div>Child Rendered: 1</div></div><div>result: 27</div><div>Parent Rendered: 5</div><div>Class4</div></div></div></root>'
			);
		});

		describe('core middleware', () => {
			describe('node', () => {
				it('should invalidate widget once node is available', () => {
					const createWidget = create({ node });
					let divNode: any;
					const App = createWidget(({ middleware }) => {
						divNode = middleware.node.get('div');
						return v('div', [undefined, v('div', { key: 'div' }), undefined]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.isNull(divNode);
					resolvers.resolve();
					assert.strictEqual(root.childNodes[0].childNodes[0], divNode);
				});

				it('should invalidate widget once body node is available', () => {
					const createWidget = create({ node });
					let divNode: any;
					const App = createWidget(({ middleware }) => {
						divNode = middleware.node.get('div');
						return v('div', [undefined, v('body', [v('div', { key: 'div' })]), undefined]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.isNull(divNode);
					resolvers.resolve();
					assert.strictEqual(document.body.lastElementChild, divNode);
				});

				it('should remove nodes from the map', () => {
					const createWidget = create({ node, invalidator });
					let divNode: any;
					let show = true;
					let invalidate: any;
					const App = createWidget(({ middleware }) => {
						divNode = middleware.node.get(1);
						invalidate = middleware.invalidator;
						return v('div', [show ? v('div', [v('div', { key: 1 }, ['hello'])]) : null]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.isNull(divNode);
					resolvers.resolve();
					let expectedDiv = root.childNodes[0].childNodes[0].childNodes[0];
					assert.strictEqual(expectedDiv, divNode);
					show = false;
					invalidate();
					resolvers.resolve();
					assert.strictEqual(expectedDiv, divNode);
					show = true;
					invalidate();
					resolvers.resolve();
					assert.isNull(divNode);
					resolvers.resolve();
					assert.strictEqual(root.childNodes[0].childNodes[0].childNodes[0], divNode);
				});
			});

			describe('destroy', () => {
				it('should invalidate widget once node is available', () => {
					const createWidget = create({ destroy, invalidator });
					let fooDestroyStub = stub();
					let barDestroyStub = stub();
					let show = true;
					let invalidate: any;
					let fooInvalidate: any;
					const Bar = createWidget(({ middleware }) => {
						middleware.destroy(() => barDestroyStub());
						return v('div', { key: 'div' });
					});
					const Foo = createWidget(({ middleware }) => {
						fooInvalidate = middleware.invalidator;
						middleware.destroy(() => fooDestroyStub());
						return v('div', { key: 'div' }, [Bar({})]);
					});
					const App = createWidget(({ middleware }) => {
						invalidate = middleware.invalidator;
						return show ? Foo({}) : null;
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.isTrue(fooDestroyStub.notCalled);
					assert.isTrue(barDestroyStub.notCalled);
					fooInvalidate();
					invalidate();
					resolvers.resolve();
					assert.isTrue(fooDestroyStub.notCalled);
					assert.isTrue(barDestroyStub.notCalled);
					show = false;
					invalidate();
					resolvers.resolve();
					assert.isTrue(fooDestroyStub.calledOnce);
					assert.isTrue(barDestroyStub.notCalled);
					resolvers.resolve();
					assert.isTrue(fooDestroyStub.calledOnce);
					assert.isTrue(barDestroyStub.calledOnce);
				});

				it('should call destroy in the correct order, deepest middleware first', () => {
					const middlewareCalled: string[] = [];
					const factoryOne = create({ destroy });

					const middlewareOne = factoryOne(({ middleware: { destroy } }) => {
						destroy(() => middlewareCalled.push('1'));
						return {};
					});

					const middlewareTwo = factoryOne(({ middleware: { destroy } }) => {
						destroy(() => middlewareCalled.push('2'));
						return {};
					});

					const factoryTwo = create({ destroy, middlewareTwo });

					const middlewareThree = factoryTwo(({ middleware: { destroy } }) => {
						destroy(() => middlewareCalled.push('3'));
						return {};
					});

					let show = true;
					let invalidate: any;

					const createWidget = create({ middlewareThree, middlewareOne, invalidator });

					const Foo = createWidget(() => {
						return null;
					});

					const App = createWidget(({ middleware }) => {
						invalidate = middleware.invalidator;
						return show ? Foo({}) : null;
					});

					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					show = false;
					invalidate();
					resolvers.resolve();
					assert.deepEqual(middlewareCalled, ['2', '3', '1']);
				});
			});

			describe('getRegistry', () => {
				it('should return the scoped registry handler', () => {
					const registry = new Registry();
					registry.defineInjector('test', () => () => 'hello world');
					const createWidget = create({ getRegistry });
					const App = createWidget(function App({ middleware }) {
						const registry = middleware.getRegistry();
						let result = '';
						if (registry) {
							const item = registry.getInjector<string>('test');
							if (item) {
								result = item.injector();
							}
						}
						return result;
					});
					const r = renderer(() => App({}));
					const div = document.createElement('div');
					r.mount({ domNode: div, registry });
					assert.strictEqual(div.outerHTML, '<div>hello world</div>');
				});
			});

			describe('defer', () => {
				it('should completely pause and resume rendering when merging', () => {
					const iframe = document.createElement('iframe');
					document.body.appendChild(iframe);
					iframe.contentDocument!.write(`<div><div>Hello Dom Foo</div><div>Hello Dom Bar</div></div>`);
					iframe.contentDocument!.close();
					const createWidget = create({ defer, invalidator });
					let shouldDefer = true;
					let invalidateFoo: any;
					const Foo = createWidget(function Foo({ middleware }) {
						invalidateFoo = middleware.invalidator;
						shouldDefer ? middleware.defer.pause() : middleware.defer.resume();
						return v('div', ['Hello Foo']);
					});
					const Bar = createWidget(function Foo() {
						return v('div', ['Hello Bar']);
					});

					const App = createWidget(function App() {
						return v('div', [Foo({}), Bar({})]);
					});
					const r = renderer(() => App({}));
					r.mount({ domNode: iframe.contentDocument!.body });
					assert.strictEqual(
						iframe.contentDocument!.body.outerHTML,
						'<body><div><div>Hello Dom Foo</div><div>Hello Dom Bar</div></div></body>'
					);
					shouldDefer = false;
					invalidateFoo();
					resolvers.resolve();
					assert.strictEqual(
						iframe.contentDocument!.body.outerHTML,
						'<body><div><div>Hello Foo</div><div>Hello Bar</div></div></body>'
					);
					document.body.removeChild(iframe);
				});

				it('should only pause the specific widget when not merging', () => {
					const createWidget = create({ defer, invalidator });
					let shouldDefer = true;
					let invalidateFoo: any;
					const Foo = createWidget(function Foo({ middleware }) {
						invalidateFoo = middleware.invalidator;
						shouldDefer ? middleware.defer.pause() : middleware.defer.resume();
						return v('div', ['Hello Foo']);
					});
					const Bar = createWidget(function Foo() {
						return v('div', ['Hello Bar']);
					});

					const App = createWidget(function App() {
						return v('div', [Foo({}), Bar({})]);
					});
					const r = renderer(() => App({}));
					const div = document.createElement('div');
					r.mount({ domNode: div });
					assert.strictEqual(div.outerHTML, '<div><div><div>Hello Bar</div></div></div>');
					invalidateFoo();
					resolvers.resolve();
					assert.strictEqual(div.outerHTML, '<div><div><div>Hello Bar</div></div></div>');
					shouldDefer = false;
					invalidateFoo();
					resolvers.resolve();
					assert.strictEqual(div.outerHTML, '<div><div><div>Hello Foo</div><div>Hello Bar</div></div></div>');
					invalidateFoo();
					resolvers.resolve();
					assert.strictEqual(div.outerHTML, '<div><div><div>Hello Foo</div><div>Hello Bar</div></div></div>');
					shouldDefer = true;
					invalidateFoo();
					resolvers.resolve();
					assert.strictEqual(div.outerHTML, '<div><div><div>Hello Bar</div></div></div>');
				});
			});

			describe('diffProperty', () => {
				it('Should call registered custom diff property function before rendering', () => {
					const createWidget = create({ diffProperty, invalidator });
					let counter = 0;
					const Foo = createWidget(({ middleware }) => {
						middleware.diffProperty('key', (current: any, properties: any) => {
							assert.deepEqual(properties, { key: 'foo' });
							middleware.invalidator();
						});
						return v('div', [`${counter++}`]);
					});
					const App = createWidget(({ middleware }) => {
						return v('div', [
							v('button', {
								onclick: () => {
									middleware.invalidator();
								}
							}),
							Foo({ key: 'foo' })
						]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>0</div></div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
					resolvers.resolve();
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>1</div></div></div>');
				});

				it('Should skip properties from the standard diff that have a custom diff registered', () => {
					const createWidget = create({ diffProperty, invalidator }).properties<any>();
					const Foo = createWidget(({ middleware, properties }) => {
						middleware.diffProperty('text', (current: any, properties: any) => {});
						return v('div', [properties().text]);
					});
					let text = 'first';
					const App = createWidget(({ middleware }) => {
						return v('div', [
							v('button', {
								onclick: () => {
									text = 'second';
									middleware.invalidator();
								}
							}),
							Foo({ key: 'foo', text })
						]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>first</div></div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
					resolvers.resolve();
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>first</div></div></div>');
				});

				it('should call diff property for the first render', () => {
					const createWidget = create({ diffProperty });
					let counter = 0;
					const Foo = createWidget(({ middleware }) => {
						middleware.diffProperty('key', () => {
							counter++;
						});
						return v('div', [`${counter}`]);
					});
					const App = createWidget(() => {
						return v('div', [v('button', {}), Foo({ key: 'foo' })]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>1</div></div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
				});

				it('Should inject property value when returned from diffProperty middleware', () => {
					const createWidget = create({ diffProperty, invalidator }).properties<{ foo?: number }>();
					let counter = 0;
					const App = createWidget(({ middleware, properties }) => {
						middleware.diffProperty('foo', properties, () => {
							return counter;
						});
						const { foo } = properties();
						return v('div', [
							v('button', {
								onclick: () => {
									counter++;
									middleware.invalidator();
								}
							}),
							v('div', [`${foo}`])
						]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>0</div></div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
					resolvers.resolve();
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>1</div></div></div>');
				});

				it('Should not use the previously injected property when comparing the previous and current properties', () => {
					const createWidget = create({ diffProperty, invalidator }).properties<{ foo?: number }>();
					let counter = 0;
					const App = createWidget(({ middleware, properties }) => {
						middleware.diffProperty('foo', properties, (current, next) => {
							if (!current.foo) {
								return counter;
							}
						});
						const { foo } = properties();
						return v('div', [
							v('button', {
								onclick: () => {
									counter++;
									middleware.invalidator();
								}
							}),
							v('div', [`${foo}`])
						]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>0</div></div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
					resolvers.resolve();
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>1</div></div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
					resolvers.resolve();
					assert.strictEqual(root.outerHTML, '<div><div><button></button><div>2</div></div></div>');
				});

				it('Should warn if properties are accessed before registering a diff property', () => {
					const createWidget = create({ diffProperty, invalidator }).properties<{ foo?: number }>();
					let counter = 0;
					const App = createWidget(function unknown({ middleware, properties }) {
						const { foo } = properties();
						middleware.diffProperty('foo', properties, () => {
							return counter;
						});
						return v('div', [
							v('button', {
								onclick: () => {
									counter++;
									middleware.invalidator();
								}
							}),
							v('div', [`${foo}`])
						]);
					});
					const r = renderer(() => App({}));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.isTrue(consoleWarnStub.calledOnce);
					assert.include(
						consoleWarnStub.firstCall.args[0],
						'Calling "propertyDiff" middleware after accessing properties in "unknown", can result in referencing stale properties.'
					);
				});

				it('should be able to return original property in favour of the wrapped property', () => {
					const createWidget = create({ diffProperty, invalidator }).properties<{ foo: () => string }>();
					function fooProperty() {
						return 'hello original';
					}
					const App = createWidget(({ middleware, properties }) => {
						middleware.diffProperty('foo', properties, (_, next) => {
							return next.foo;
						});
						const { foo } = properties();
						assert.strictEqual(foo, fooProperty);
						return (
							<div>
								<button
									onclick={() => {
										middleware.invalidator();
									}}
								/>
								<div>{foo()}</div>
							</div>
						);
					});
					const r = renderer(() => App({ foo: fooProperty }));
					const root = document.createElement('div');
					r.mount({ domNode: root });
					assert.strictEqual(root.innerHTML, '<div><button></button><div>hello original</div></div>');
					sendEvent(root.childNodes[0].childNodes[0] as HTMLButtonElement, 'click');
					resolvers.resolve();
					assert.strictEqual(root.innerHTML, '<div><button></button><div>hello original</div></div>');
				});
			});
		});
	});

	describe('create', () => {
		it('should default to document body if null is passed as the mount domNode', () => {
			const r = renderer(() => v('div', { id: 'my-div' }, ['hello, world!']));
			r.mount({ domNode: document.getElementById('unknown-id') });
			const div = document.getElementById('my-div');
			assert.isOk(div);
			assert.strictEqual(div!.parentNode, document.body);
			assert.isTrue(consoleWarnStub.calledOnce);
			assert.strictEqual(
				consoleWarnStub.firstCall.args[0],
				'Unable to find node to mount the application, defaulting to the document body.'
			);
		});

		it('should support rendering vnodes only', () => {
			const r = renderer(() => v('div', ['hello, world!']));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>hello, world!</div>');
		});

		it('should create and update single text nodes', () => {
			const [Widget, meta] = getWidget(v('div', ['text']));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text</div>');
			meta.setRenderResult(v('div', ['text2']));
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text2</div>');
			meta.setRenderResult(v('div', ['text2', v('span', ['a'])]));
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text2<span>a</span></div>');

			meta.setRenderResult(v('div', ['text2']));
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text2</div>');
			meta.setRenderResult(v('div', ['text']));
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text</div>');
		});

		it('should work correctly with adjacent text nodes', () => {
			const [Widget, meta] = getWidget(v('div', ['', '1', '']));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>1</div>');
			meta.setRenderResult(v('div', [' ', '']));
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div> </div>');
			meta.setRenderResult(v('div', ['', '1', '']));
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>1</div>');
		});

		it('should break update when vdom object references are equal', () => {
			const vnode = v('div', ['text']);
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text</div>');
			vnode.text = 'new';
			meta.setRenderResult(vnode);
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>text</div>');
		});

		it('should allow changing the root selector', () => {
			const [Widget, meta] = getWidget(v('div'));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual(div.children[0].tagName, 'DIV');
			meta.setRenderResult(v('span'));
			assert.strictEqual(div.children[0].tagName, 'SPAN');
		});

		it('should allow an existing dom node to be used', () => {
			const node = document.createElement('div');
			(node as any).foo = 'foo';
			const childNode = document.createElement('span');
			(childNode as any).bar = 'bar';
			node.appendChild(childNode);
			const appendChildSpy = spy(node, 'appendChild');

			const childVNode = v('span', { id: 'b' }) as DomVNode;
			childVNode.domNode = childNode;
			const vNode = v('div', { id: 'a' }, [childVNode]) as DomVNode;
			vNode.domNode = node;

			const root: any = document.createElement('div');
			const [Widget] = getWidget(vNode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: root, sync: true });
			assert.strictEqual(root.childNodes[0].outerHTML, '<div id="a"><span id="b"></span></div>');
			assert.strictEqual(root.childNodes[0].foo, 'foo');
			assert.strictEqual(root.childNodes[0].children[0].bar, 'bar');
			assert.isFalse(appendChildSpy.called);
		});

		it('will append nodes with attributes already attached', (test) => {
			const expected = '<div data-attr="test"></div>';
			const appendedHtml: string[] = [];

			const createElement = document.createElement.bind(document);
			const createElementStub = stub(document, 'createElement').callsFake((name: string) => {
				const node = createElement(name);
				const appendChild = node.appendChild.bind(node);
				stub(node, 'insertBefore').callsFake((node: Element) => {
					appendedHtml.push(node.outerHTML);
					return appendChild(node);
				});
				return node;
			});
			spys.push(createElementStub);
			const [Widget] = getWidget(v('div', { 'data-attr': 'test' }));
			const root: any = document.createElement('div');
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: root, sync: true });
			assert.strictEqual(root.innerHTML, expected);
			assert.lengthOf(appendedHtml, 1);
			assert.strictEqual(appendedHtml[0], expected);
		});
	});

	describe('body node', () => {
		let root = document.createElement('div');
		beforeEach(() => {
			root = document.createElement('div');
			document.body.appendChild(root);
		});

		afterEach(() => {
			document.body.removeChild(root);
		});

		it('can attach a node to the body', () => {
			let show = true;
			const factory = create({ invalidator });
			const App = factory(function App({ middleware: { invalidator } }) {
				return v('div', [
					v('button', {
						onclick: () => {
							show = !show;
							invalidator();
						}
					}),
					v('body', [show ? v('div', { id: 'my-body-node-1' }, ['My Body Div 1']) : null]),
					v('body', [show ? v('div', { id: 'my-body-node-2' }, ['My Body Div 2']) : null])
				]);
			});
			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });
			let bodyNodeOne = document.getElementById('my-body-node-1')!;
			assert.isOk(bodyNodeOne);
			assert.strictEqual(bodyNodeOne.outerHTML, '<div id="my-body-node-1">My Body Div 1</div>');
			assert.strictEqual(bodyNodeOne.parentNode, document.body);
			assert.isNull(root.querySelector('#my-body-node-1'));
			let bodyNodeTwo = document.getElementById('my-body-node-2')!;
			assert.isOk(bodyNodeTwo);
			assert.strictEqual(bodyNodeTwo.outerHTML, '<div id="my-body-node-2">My Body Div 2</div>');
			assert.strictEqual(bodyNodeTwo.parentNode, document.body);
			assert.isNull(root.querySelector('#my-body-node-2'));
			sendEvent(root.childNodes[0].childNodes[0] as Element, 'click');
			resolvers.resolve();
			bodyNodeOne = document.getElementById('my-body-node-1')!;
			assert.isNull(bodyNodeOne);
			assert.isNull(root.querySelector('#my-body-node-1'));
			bodyNodeTwo = document.getElementById('my-body-node-2')!;
			assert.isNull(bodyNodeTwo);
			assert.isNull(root.querySelector('#my-body-node-2'));
		});

		it('can attach body and have widgets inserted nodes that are positioned after the body', () => {
			const factory = create({ icache });
			const Button = factory(function Button({ children }) {
				return (
					<div>
						<button>{children()}</button>
					</div>
				);
			});
			const Body = factory(function Button({ children }) {
				return (
					<body>
						<div id="body-node">{children()}</div>
					</body>
				);
			});
			const App = factory(function App({ middleware }) {
				const open = middleware.icache.getOrSet('open', false);
				return (
					<div>
						<div>first</div>
						{open && <Button>Close</Button>}
						{open && <Body>Body</Body>}
						<div>
							<button
								onclick={() => {
									middleware.icache.set('open', !middleware.icache.getOrSet('open', false));
								}}
							>
								Click Me
							</button>
						</div>
					</div>
				);
			});

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });
			(root as any).children[0].children[1].children[0].click();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><div>first</div><div><button>Close</button></div><div><button>Click Me</button></div></div>'
			);
			const bodyNode = document.getElementById('body-node');
			assert.isNotNull(bodyNode);
			assert.strictEqual(bodyNode!.outerHTML, '<div id="body-node">Body</div>');
		});

		it('should detach nested body nodes from dom', () => {
			let doShow: any;

			class A extends WidgetBase<any> {
				render() {
					return v('div', [v('body', [v('span', { classes: ['body-span'] }, ['and im in the body!'])])]);
				}
			}

			class App extends WidgetBase {
				private renderWidget = false;

				constructor() {
					super();
					doShow = () => {
						this.renderWidget = !this.renderWidget;
						this.invalidate();
					};
				}

				protected render() {
					return v('div', [this.renderWidget && w(A, {})]);
				}
			}

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });

			let results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
		});

		it('should detach widgets nested in a body tag', () => {
			let doShow: any;

			class A extends WidgetBase<any> {
				render() {
					return v('div', [v('body', [w(B, {})])]);
				}
			}

			class B extends WidgetBase<any> {
				render() {
					return v('span', { classes: ['body-span'] }, ['and im in the body!!']);
				}
			}

			class App extends WidgetBase {
				private show = true;

				constructor() {
					super();
					doShow = () => {
						this.show = !this.show;
						this.invalidate();
					};
				}

				protected render() {
					return v('div', [this.show && w(A, {})]);
				}
			}

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });

			let results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
		});

		it('should detach virtual nodes nested in a body tag', () => {
			let doShow: any;

			class A extends WidgetBase<any> {
				render() {
					return v('div', [
						v('body', [v('virtual', [v('span', { classes: ['body-span'] }, ['and im in the body!!'])])])
					]);
				}
			}

			class App extends WidgetBase {
				private show = true;

				constructor() {
					super();
					doShow = () => {
						this.show = !this.show;
						this.invalidate();
					};
				}

				protected render() {
					return v('div', [this.show && w(A, {})]);
				}
			}

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });

			let results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.body-span');
			assert.lengthOf(results, 0);
		});

		it('should support attaching body nodes in nested widgets', () => {
			const factory = create({ icache }).properties<any>();

			const Foo = factory(function Foo() {
				return (
					<div id="wrapper-2">
						<body>
							<div id="body-2" />
						</body>
					</div>
				);
			});

			const Bar = factory(function Bar({ properties }) {
				return (
					<div id="wrapper-1">
						<Foo close={() => properties().close()} />
						<body>
							<div id="body-1" />
						</body>
					</div>
				);
			});

			const App = factory(function App({ middleware: { icache } }) {
				const show = icache.getOrSet('show', false);
				return (
					<div>
						<button
							onclick={() => {
								icache.set('show', (current) => !current);
							}}
						>
							Open/Close
						</button>
						{show && (
							<Bar
								close={() => {
									icache.set('show', false);
								}}
							/>
						)}
						<h2>Start editing to see some magic happen</h2>
					</div>
				);
			});

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });
			(root.children[0].children[0] as any).click();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><button>Open/Close</button><div id="wrapper-1"><div id="wrapper-2"></div></div><h2>Start editing to see some magic happen</h2></div>'
			);
			assert.lengthOf(document.querySelectorAll('#body-1'), 1);
			assert.lengthOf(document.querySelectorAll('#body-2'), 1);
			(root.children[0].children[0] as any).click();
			resolvers.resolve();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><button>Open/Close</button><h2>Start editing to see some magic happen</h2></div>'
			);
			assert.lengthOf(document.querySelectorAll('#body-1'), 0);
			assert.lengthOf(document.querySelectorAll('#body-2'), 0);
		});
	});

	describe('head node', () => {
		let root = document.createElement('div');
		beforeEach(() => {
			root = document.createElement('div');
			document.body.appendChild(root);
		});

		afterEach(() => {
			document.body.removeChild(root);
		});

		it('can attach a node to the head', () => {
			let show = true;
			const factory = create({ invalidator });
			const App = factory(function App({ middleware: { invalidator } }) {
				return v('div', [
					v('button', {
						onclick: () => {
							show = !show;
							invalidator();
						}
					}),
					v('head', [show ? v('div', { id: 'my-head-node-1' }, ['My head Div 1']) : null]),
					v('head', [show ? v('div', { id: 'my-head-node-2' }, ['My head Div 2']) : null])
				]);
			});
			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });
			let headNodeOne = document.getElementById('my-head-node-1')!;
			assert.isOk(headNodeOne);
			assert.strictEqual(headNodeOne.outerHTML, '<div id="my-head-node-1">My head Div 1</div>');
			assert.strictEqual(headNodeOne.parentNode, document.head);
			assert.isNull(root.querySelector('#my-head-node-1'));
			let headNodeTwo = document.getElementById('my-head-node-2')!;
			assert.isOk(headNodeTwo);
			assert.strictEqual(headNodeTwo.outerHTML, '<div id="my-head-node-2">My head Div 2</div>');
			assert.strictEqual(headNodeTwo.parentNode, document.head);
			assert.isNull(root.querySelector('#my-head-node-2'));
			sendEvent(root.childNodes[0].childNodes[0] as Element, 'click');
			resolvers.resolve();
			headNodeOne = document.getElementById('my-head-node-1')!;
			assert.isNull(headNodeOne);
			assert.isNull(root.querySelector('#my-head-node-1'));
			headNodeTwo = document.getElementById('my-head-node-2')!;
			assert.isNull(headNodeTwo);
			assert.isNull(root.querySelector('#my-head-node-2'));
		});

		it('can attach head and have widgets inserted nodes that are positioned after the head', () => {
			const factory = create({ icache });
			const Button = factory(function Button({ children }) {
				return (
					<div>
						<button>{children()}</button>
					</div>
				);
			});
			const Head = factory(function Button({ children }) {
				return (
					<head>
						<div id="head-node">{children()}</div>
					</head>
				);
			});
			const App = factory(function App({ middleware }) {
				const open = middleware.icache.getOrSet('open', false);
				return (
					<div>
						<div>first</div>
						{open && <Button>Close</Button>}
						{open && <Head>Head</Head>}
						<div>
							<button
								onclick={() => {
									middleware.icache.set('open', !middleware.icache.getOrSet('open', false));
								}}
							>
								Click Me
							</button>
						</div>
					</div>
				);
			});

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });
			(root as any).children[0].children[1].children[0].click();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><div>first</div><div><button>Close</button></div><div><button>Click Me</button></div></div>'
			);
			const headNode = document.getElementById('head-node');
			assert.isNotNull(headNode);
			assert.strictEqual(headNode!.outerHTML, '<div id="head-node">Head</div>');
		});

		it('should detach nested head nodes from dom', () => {
			let doShow: any;

			class A extends WidgetBase<any> {
				render() {
					return v('div', [v('head', [v('span', { classes: ['head-span'] }, ['and im in the head!'])])]);
				}
			}

			class App extends WidgetBase {
				private renderWidget = false;

				constructor() {
					super();
					doShow = () => {
						this.renderWidget = !this.renderWidget;
						this.invalidate();
					};
				}

				protected render() {
					return v('div', [this.renderWidget && w(A, {})]);
				}
			}

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });

			let results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
		});

		it('should detach widgets nested in a head tag', () => {
			let doShow: any;

			class A extends WidgetBase<any> {
				render() {
					return v('div', [v('head', [w(B, {})])]);
				}
			}

			class B extends WidgetBase<any> {
				render() {
					return v('span', { classes: ['head-span'] }, ['and im in the head!!']);
				}
			}

			class App extends WidgetBase {
				private show = true;

				constructor() {
					super();
					doShow = () => {
						this.show = !this.show;
						this.invalidate();
					};
				}

				protected render() {
					return v('div', [this.show && w(A, {})]);
				}
			}

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });

			let results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
		});

		it('should detach virtual nodes nested in a head tag', () => {
			let doShow: any;

			class A extends WidgetBase<any> {
				render() {
					return v('div', [
						v('head', [v('virtual', [v('span', { classes: ['head-span'] }, ['and im in the head!!'])])])
					]);
				}
			}

			class App extends WidgetBase {
				private show = true;

				constructor() {
					super();
					doShow = () => {
						this.show = !this.show;
						this.invalidate();
					};
				}

				protected render() {
					return v('div', [this.show && w(A, {})]);
				}
			}

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });

			let results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 1);
			doShow();
			resolvers.resolveRAF();
			resolvers.resolveRAF();
			results = document.querySelectorAll('.head-span');
			assert.lengthOf(results, 0);
		});

		it('should support attaching head nodes in nested widgets', () => {
			const factory = create({ icache }).properties<any>();

			const Foo = factory(function Foo() {
				return (
					<div id="wrapper-2">
						<head>
							<div id="head-2" />
						</head>
					</div>
				);
			});

			const Bar = factory(function Bar({ properties }) {
				return (
					<div id="wrapper-1">
						<Foo close={() => properties().close()} />
						<head>
							<div id="head-1" />
						</head>
					</div>
				);
			});

			const App = factory(function App({ middleware: { icache } }) {
				const show = icache.getOrSet('show', false);
				return (
					<div>
						<button
							onclick={() => {
								icache.set('show', (current) => !current);
							}}
						>
							Open/Close
						</button>
						{show && (
							<Bar
								close={() => {
									icache.set('show', false);
								}}
							/>
						)}
						<h2>Start editing to see some magic happen</h2>
					</div>
				);
			});

			const r = renderer(() => w(App, {}));
			r.mount({ domNode: root });
			(root.children[0].children[0] as any).click();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><button>Open/Close</button><div id="wrapper-1"><div id="wrapper-2"></div></div><h2>Start editing to see some magic happen</h2></div>'
			);
			assert.lengthOf(document.querySelectorAll('#head-1'), 1);
			assert.lengthOf(document.querySelectorAll('#head-2'), 1);
			(root.children[0].children[0] as any).click();
			resolvers.resolve();
			resolvers.resolve();
			assert.strictEqual(
				root.innerHTML,
				'<div><button>Open/Close</button><h2>Start editing to see some magic happen</h2></div>'
			);
			assert.lengthOf(document.querySelectorAll('#head-1'), 0);
			assert.lengthOf(document.querySelectorAll('#head-2'), 0);
		});
	});

	describe('virtual node', () => {
		it('can use a virtual node', () => {
			const [Widget, meta] = getWidget(v('virtual', [v('div', ['one', 'two', v('div', ['three'])])]));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>onetwo<div>three</div></div>');
			meta.setRenderResult(v('virtual', [v('div', ['four', 'five', v('div', ['six'])])]));
			resolvers.resolve();
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>fourfive<div>six</div></div>');
			meta.setRenderResult(v('div', ['one', 'two', v('div', ['three'])]));
			resolvers.resolve();
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>onetwo<div>three</div></div>');
			meta.setRenderResult(v('virtual', [v('div', ['four', 'five', v('div', ['six'])])]));
			resolvers.resolve();
			assert.strictEqual((div.childNodes[0] as Element).outerHTML, '<div>fourfive<div>six</div></div>');
		});

		it('can use a virtual node with widgets', () => {
			class Foo extends WidgetBase<any> {
				render() {
					return v('div', [this.properties.text]);
				}
			}
			const [Widget, meta] = getWidget(
				v('virtual', [w(Foo, { text: 'one' }), w(Foo, { text: 'two' }), w(Foo, { text: 'three' })])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			assert.strictEqual(div.outerHTML, '<div><div>one</div><div>two</div><div>three</div></div>');
			meta.setRenderResult(
				v('virtual', [w(Foo, { text: 'four' }), w(Foo, { text: 'five' }), w(Foo, { text: 'six' })])
			);
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>four</div><div>five</div><div>six</div></div>');
			meta.setRenderResult([w(Foo, { text: 'one' }), w(Foo, { text: 'two' }), w(Foo, { text: 'three' })]);
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>one</div><div>two</div><div>three</div></div>');
			meta.setRenderResult(
				v('virtual', [w(Foo, { text: 'four' }), w(Foo, { text: 'five' }), w(Foo, { text: 'six' })])
			);
			resolvers.resolve();
			assert.strictEqual(div.outerHTML, '<div><div>four</div><div>five</div><div>six</div></div>');
		});

		it('can use virtual node in maps', () => {
			let buttonClick: any;
			class App extends WidgetBase {
				private _items = [0];
				private _toggled = false;

				constructor() {
					super();
					buttonClick = () => {
						this._toggled = !this._toggled;
						this._items.push(this._items.length);
						this.invalidate();
					};
				}
				protected render() {
					const nodes = this._items.map((item) => {
						return v('virtual', [v('span', [`Yay ${item}`]), this._toggled && v('div', ['Toggled'])]);
					});

					return v('div', [v('h2', ['List']), ...nodes, v('button', ['toggle'])]);
				}
			}
			const r = renderer(() => w(App, {}));
			const div = document.createElement('div');
			document.body.appendChild(div);
			r.mount({ domNode: div });
			assert.strictEqual(
				div.outerHTML,
				'<div><div><h2>List</h2><span>Yay 0</span><button>toggle</button></div></div>'
			);
			buttonClick();
			resolvers.resolve();
			assert.strictEqual(
				div.outerHTML,
				'<div><div><h2>List</h2><span>Yay 0</span><div>Toggled</div><span>Yay 1</span><div>Toggled</div><button>toggle</button></div></div>'
			);
			buttonClick();
			resolvers.resolve();
			assert.strictEqual(
				div.outerHTML,
				'<div><div><h2>List</h2><span>Yay 0</span><span>Yay 1</span><span>Yay 2</span><button>toggle</button></div></div>'
			);
			buttonClick();
			resolvers.resolve();
			assert.strictEqual(
				div.outerHTML,
				'<div><div><h2>List</h2><span>Yay 0</span><div>Toggled</div><span>Yay 1</span><div>Toggled</div><span>Yay 2</span><div>Toggled</div><span>Yay 3</span><div>Toggled</div><button>toggle</button></div></div>'
			);
		});
	});

	describe('properties', () => {
		it('does not add "key" to the dom node', () => {
			const [Widget] = getWidget(v('div', { key: '1' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.isNull(root.getAttribute('key'));
		});

		it('sets properties even when the default DOM node value matches', () => {
			const [Widget] = getWidget(v('div', { tabIndex: -1 }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.strictEqual(root.getAttribute('tabindex'), '-1');
		});

		it('updates attributes', () => {
			const [Widget, meta] = getWidget(v('a', { href: '#1' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.strictEqual(root.getAttribute('href'), '#1');
			meta.setRenderResult(v('a', { href: '#2' }));
			assert.strictEqual(root.getAttribute('href'), '#2');
			meta.setRenderResult(v('a', { href: undefined }));
			assert.strictEqual(root.getAttribute('href'), '');
		});

		it('can add an attribute that was initially undefined', () => {
			const [Widget, meta] = getWidget(v('a', { href: undefined }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const link = (div.childNodes[0] as Element) as HTMLLinkElement;
			assert.isNull(link.getAttribute('href'));
			meta.setRenderResult(v('a', { href: '#2' }));
			assert.strictEqual(link.getAttribute('href'), '#2');
		});

		it('can remove disabled property when set to null or undefined', () => {
			const [Widget, meta] = getWidget(v('a', { disabled: true }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const link = div.childNodes[0] as HTMLLinkElement;
			assert.isTrue(link.disabled);
			meta.setRenderResult(v('a', { disabled: null as any }));
			assert.isFalse(!!link.disabled);
		});

		it('updates properties', () => {
			const [Widget, meta] = getWidget(v('a', { href: '#1', tabIndex: 1 }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const link = div.childNodes[0] as HTMLLinkElement;
			assert.strictEqual(link.tabIndex, 1);
			meta.setRenderResult(v('a', { href: '#1', tabIndex: 2 }));
			assert.strictEqual(link.tabIndex, 2);
			meta.setRenderResult(v('a', { href: '#1', tabIndex: undefined }));
			assert.strictEqual(link.tabIndex, 0);
		});

		it('updates innerHTML', () => {
			const [Widget, meta] = getWidget(v('p', { innerHTML: '<span>INNER</span>' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.lengthOf(root.childNodes, 1);
			assert.strictEqual(root.childNodes[0].textContent, 'INNER');
			meta.setRenderResult(v('p', { innerHTML: '<span>UPDATED</span>' }));
			assert.lengthOf(root.childNodes, 1);
			assert.strictEqual(root.childNodes[0].textContent, 'UPDATED');
		});

		it('does not mess up scrolling in Edge', () => {
			const [Widget, meta] = getWidget(v('div', { scrollTop: 0 }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			Object.defineProperty(root, 'scrollTop', {
				get: () => 1,
				set: stub().throws('Setting scrollTop would mess up scrolling')
			}); // meaning: div.scrollTop = 1;
			meta.setRenderResult(v('div', { scrollTop: 1 }));
		});

		describe('classes', () => {
			it('adds and removes classes', () => {
				const [Widget, meta] = getWidget(v('div', { classes: ['a'] }));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true });
				const root = div.childNodes[0] as HTMLElement;
				assert.strictEqual(root.className, 'a');
				meta.setRenderResult(v('div', { classes: ['a', 'b'] }));
				assert.strictEqual(root.className, 'a b');
				meta.setRenderResult(v('div', { classes: ['b'] }));
				assert.strictEqual(root.className, 'b');
			});

			it('should leave classes that are not controlled', () => {
				const div = document.createElement('div');
				div.className = 'c b';
				const root = document.createElement('div');
				root.appendChild(div);
				const [Widget, meta] = getWidget(v('div', { classes: ['a'] }));
				const r = renderer(() => w(Widget, {}));
				r.mount({ domNode: root, sync: true });
				assert.strictEqual(div.className, 'b c a');
				meta.setRenderResult(v('div', { classes: ['a', 'b'] }));
				assert.strictEqual(div.className, 'a b');
				meta.setRenderResult(v('div', { classes: ['b'] }));
				assert.strictEqual(div.className, 'b');
				meta.setRenderResult(v('div'));
				assert.strictEqual(div.className, '');
			});

			it('supports null, undefined and zero length strings in classes', () => {
				const div = document.createElement('div');
				div.className = 'b';
				const root = document.createElement('div');
				root.appendChild(div);
				const [Widget, meta] = getWidget(v('div', { classes: ['b', null, null, null] }));
				const r = renderer(() => w(Widget, {}));
				r.mount({ domNode: root, sync: true });
				assert.strictEqual(div.className, 'b');
				meta.setRenderResult(v('div', { classes: ['a', null, undefined, ''] }));

				assert.strictEqual(div.className, 'a');

				meta.setRenderResult(v('div', { classes: ['a', null, undefined, ''] }));

				assert.strictEqual(div.className, 'a');
				meta.setRenderResult(v('div', { classes: [] }));

				assert.strictEqual(div.className, '');
				meta.setRenderResult(v('div', { classes: ['a', null, undefined, ''] }));

				assert.strictEqual(div.className, 'a');
				meta.setRenderResult(v('div'));

				assert.strictEqual(div.className, '');
			});

			it('classes accepts a string', () => {
				const [Widget, meta] = getWidget(v('div', { classes: 'b' }));
				const div = document.createElement('div');
				const root = document.createElement('div');
				root.appendChild(div);
				const r = renderer(() => w(Widget, {}));
				r.mount({ domNode: root, sync: true });
				assert.strictEqual(div.className, 'b');
				meta.setRenderResult(v('div', { classes: 'b' }));

				assert.strictEqual(div.className, 'b');

				meta.setRenderResult(v('div', { classes: 'a' }));

				assert.strictEqual(div.className, 'a');
				meta.setRenderResult(v('div'));

				assert.strictEqual(div.className, '');
				meta.setRenderResult(v('div', { classes: null }));

				assert.strictEqual(div.className, '');
				meta.setRenderResult(v('div'));

				meta.setRenderResult(v('div', { classes: 'a b' }));

				assert.strictEqual(div.className, 'a b');
			});

			it('should split class names by space before applying/removing', () => {
				const [Widget, meta] = getWidget(v('div', { classes: 'a b' }));
				const div = document.createElement('div');
				const root = document.createElement('div');
				root.appendChild(div);
				const r = renderer(() => w(Widget, {}));
				r.mount({ domNode: root, sync: true });
				assert.strictEqual(div.className, 'a b');
				meta.setRenderResult(v('div'));

				assert.strictEqual(div.className, '');

				meta.setRenderResult(v('div', { classes: ['a b'] }));

				assert.strictEqual(div.className, 'a b');
				meta.setRenderResult(v('div'));

				assert.strictEqual(div.className, '');
			});

			it('should accept falsy as a class', () => {
				const [Widget] = getWidget(v('div', { classes: ['my-class', null, undefined, false, true, 'other'] }));
				const div = document.createElement('div');
				const root = document.createElement('div');
				root.appendChild(div);
				const r = renderer(() => w(Widget, {}));
				r.mount({ domNode: root, sync: true });
				assert.strictEqual(div.className, 'my-class other');
			});

			it('can add and remove multiple classes in IE11', () => {
				const [Widget, meta] = getWidget(v('div', { classes: 'a b c d' }));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true });
				const root = div.childNodes[0] as HTMLElement;
				assert.strictEqual(root.className, 'a b c d');
				meta.setRenderResult(v('div', { classes: 'a b' }));
			});
		});

		describe('styles', () => {
			it('should add styles to the real DOM', () => {
				const [Widget] = getWidget(v('div', { styles: { height: '20px' } }));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true });
				const root = div.childNodes[0] as HTMLElement;
				assert.strictEqual(root.outerHTML, '<div style="height: 20px;"></div>');
			});

			it('should update styles', () => {
				const [Widget, meta] = getWidget(v('div', { styles: { height: '20px' } }));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true });
				const root = div.childNodes[0] as HTMLElement;
				meta.setRenderResult(v('div', { styles: { height: '30px' } }));

				assert.strictEqual(root.outerHTML, '<div style="height: 30px;"></div>');
			});

			it('should remove styles', () => {
				const [Widget, meta] = getWidget(v('div', { styles: { width: '30px', height: '20px' } }));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true });
				const root = div.childNodes[0] as HTMLElement;
				meta.setRenderResult(v('div', { styles: { height: undefined, width: '30px' } }));

				assert.strictEqual(root.outerHTML, '<div style="width: 30px;"></div>');
			});

			it('should add styles', () => {
				const [Widget, meta] = getWidget(v('div', { styles: { height: undefined } }));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true });
				const root = div.childNodes[0] as HTMLElement;
				meta.setRenderResult(v('div', { styles: { height: '20px' } }));

				assert.strictEqual(root.outerHTML, '<div style="height: 20px;"></div>');
				meta.setRenderResult(v('div', { styles: { height: '20px' } }));
			});
		});

		it('updates the value property', () => {
			let typedKeys = '';
			const handleInput = (evt: Event) => {
				typedKeys = (evt.target as HTMLInputElement).value;
			};
			const renderFunction = () => v('input', { value: typedKeys, oninput: handleInput });
			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLInputElement;
			assert.strictEqual(root.value, typedKeys);
			typedKeys = 'value1';
			meta.setRenderResult(renderFunction());
			assert.strictEqual(root.value, typedKeys);
		});

		it('does not clear a value that was set by a testing tool which manipulates input.value directly', () => {
			let typedKeys = '';

			const renderFunction = () =>
				v('input', {
					value: typedKeys,
					oninput: (evt) => {
						typedKeys = evt.target.value;
					},
					onclick: (evt) => {
						typedKeys = evt.target.value;
					}
				});

			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLInputElement;
			assert.strictEqual(root.value, typedKeys);
			root.value = 'value written by a testing tool without invoking the input event';
			meta.setRenderResult(renderFunction());
			assert.notStrictEqual(root.value, typedKeys);
		});

		it('Can handle oninput event handlers which pro-actively change element.value to correct user input when typing faster than 60 keys per second', () => {
			let model = '';
			const handleInput = (evt: Event) => {
				const inputElement = evt.target as HTMLInputElement;
				model = inputElement.value;
				if (model.indexOf(',') > 0) {
					model = model.replace(/,/g, '.');
					inputElement.value = model;
				}
			};

			const renderFunction = () => v('input', { value: model, oninput: handleInput });
			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLInputElement;
			assert.strictEqual(root.value, model);

			root.value = '4';
			sendEvent(root, 'input');
			meta.setRenderResult(renderFunction());

			root.value = '4,';
			sendEvent(root, 'input');
			meta.setRenderResult(renderFunction());

			assert.strictEqual(root.value, '4.');

			model = '';
			meta.setRenderResult(renderFunction());

			assert.strictEqual(root.value, '');
		});

		it('removes the attribute when a role property is set to undefined', () => {
			let role: string | undefined = 'button';
			const renderFunction = () => v('div', { role: role });
			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.property(root.attributes, 'role');
			assert.strictEqual(root.getAttribute('role'), role);
			role = undefined;
			meta.setRenderResult(renderFunction());
			assert.notProperty(root.attributes, 'role');
		});
	});

	describe('diffType', () => {
		it('Should diff against previous properties with diffType `vdom`', () => {
			let vnode = v('div', { foo: 'bar', bar: 1 });
			vnode.diffType = 'vdom';
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = v('div', { foo: 'bar', bar: 1 });
			vnode.diffType = 'vdom';
			meta.setRenderResult(vnode);
			assert.strictEqual('baz', root.getAttribute('foo'));
			assert.strictEqual(2, root.bar);
			vnode = v('div', { foo: 'qux', bar: 3 });
			vnode.diffType = 'vdom';
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
		});

		it('Should always set properties/attribute with diffType `none`', () => {
			let vnode = v('div', { foo: 'bar', bar: 1 });
			vnode.diffType = 'none';
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = v('div', { foo: 'bar', bar: 1 });
			vnode.diffType = 'none';
			meta.setRenderResult(vnode);
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			vnode = v('div', { foo: 'qux', bar: 3 });
			vnode.diffType = 'none';
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
		});

		it('Should diff against values on the DOM with diffType `dom`', () => {
			let vnode = v('div', { foo: 'bar', bar: 1 });
			vnode.diffType = 'dom';
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = v('div', { foo: 'bar', bar: 1 });
			vnode.diffType = 'dom';
			meta.setRenderResult(vnode);
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			vnode = v('div', { foo: 'qux', bar: 3 });
			vnode.diffType = 'dom';
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
		});

		it('Should use diffType `vdom` by default', () => {
			const [Widget, meta] = getWidget(v('div', { foo: 'bar', bar: 1 }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			meta.setRenderResult(v('div', { foo: 'bar', bar: 1 }));
			assert.strictEqual('baz', root.getAttribute('foo'));
			assert.strictEqual(2, root.bar);
			meta.setRenderResult(v('div', { foo: 'qux', bar: 3 }));
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
		});
	});

	describe('dom VNode', () => {
		it('Should diff against previous properties with diffType `vdom`', () => {
			const append = document.createElement('div');
			const div = document.createElement('div');
			let clickerCount = 0;
			const click = () => {
				clickerCount++;
			};
			let vnode = d({
				node: div,
				props: { foo: 'bar', bar: 1 },
				attrs: { baz: 'foo', qux: 'qux' },
				on: { click },
				diffType: 'vdom'
			});
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: append, sync: true });
			const root = append.childNodes[0] as any;
			assert.strictEqual('bar', root.foo);
			assert.strictEqual('foo', root.getAttribute('baz'));
			assert.strictEqual('qux', root.getAttribute('qux'));
			assert.strictEqual(1, root.bar);
			const clickEvent = document.createEvent('CustomEvent');
			clickEvent.initEvent('click', true, true);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 1);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = d({
				node: div,
				props: { foo: 'bar', bar: 2 },
				attrs: { baz: undefined, qux: 'qux' },
				on: { click },
				diffType: 'vdom'
			});
			meta.setRenderResult(vnode);
			assert.strictEqual('bar', root.foo);
			assert.strictEqual(null, root.getAttribute('baz'));
			assert.strictEqual('qux', root.getAttribute('qux'));
			assert.strictEqual(2, root.bar);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 2);
			vnode = d({
				node: div,
				props: { foo: 'qux', bar: 3 },
				attrs: { baz: 'foo', qux: 'qux' },
				diffType: 'vdom'
			});
			root.baz = 'baz';
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.foo);
			assert.strictEqual('foo', root.getAttribute('baz'));
			assert.strictEqual('qux', root.getAttribute('qux'));
			assert.strictEqual(3, root.bar);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 2);
		});
		it('Should always set properties/attribute with diffType `none`', () => {
			const append = document.createElement('div');
			const div = document.createElement('div');
			let clickerCount = 0;
			let secondClickerCount = 0;
			const click = () => {
				clickerCount++;
			};
			const secondClick = () => {
				secondClickerCount++;
			};
			let vnode = d({ node: div, props: { bar: 1 }, attrs: { foo: 'bar' }, on: { click }, diffType: 'none' });
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: append, sync: true });
			const root = append.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			const clickEvent = document.createEvent('CustomEvent');
			clickEvent.initEvent('click', true, true);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 1);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = d({
				node: div,
				props: { bar: 1 },
				attrs: { foo: 'bar' },
				on: { click: secondClick },
				diffType: 'none'
			});
			meta.setRenderResult(vnode);
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 1);
			assert.strictEqual(secondClickerCount, 1);
			vnode = d({ node: div, props: { bar: 3 }, attrs: { foo: 'qux' }, diffType: 'none' });
			vnode.diffType = 'none';
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 1);
			assert.strictEqual(secondClickerCount, 1);
		});
		it('Should diff against values on the DOM with diffType `dom`', () => {
			const append = document.createElement('div');
			const div = document.createElement('div');
			let clickerCount = 0;
			const click = () => {
				clickerCount++;
			};
			let vnode = d({ node: div, props: { bar: 1 }, attrs: { foo: 'bar' }, on: { click }, diffType: 'dom' });
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: append, sync: true });
			const root = append.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			const clickEvent = document.createEvent('CustomEvent');
			clickEvent.initEvent('click', true, true);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 1);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = d({ node: div, props: { bar: 1 }, attrs: { foo: 'bar' }, on: { click }, diffType: 'dom' });
			meta.setRenderResult(vnode);
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 2);
			vnode = d({ node: div, props: { bar: 3 }, attrs: { foo: 'qux' }, diffType: 'dom' });
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
			root.dispatchEvent(clickEvent);
			assert.strictEqual(clickerCount, 2);
		});
		it('Should use diffType `none` by default', () => {
			const append = document.createElement('div');
			const div = document.createElement('div');
			let vnode = d({ node: div, props: { bar: 1 }, attrs: { foo: 'bar' } });
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: append, sync: true });
			const root = append.childNodes[0] as any;
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			root.bar = 2;
			root.setAttribute('foo', 'baz');
			vnode = d({ node: div, props: { bar: 1 }, attrs: { foo: 'bar' } });
			meta.setRenderResult(vnode);
			assert.strictEqual('bar', root.getAttribute('foo'));
			assert.strictEqual(1, root.bar);
			vnode = d({ node: div, props: { bar: 3 }, attrs: { foo: 'qux' } });
			vnode.diffType = 'none';
			meta.setRenderResult(vnode);
			assert.strictEqual('qux', root.getAttribute('foo'));
			assert.strictEqual(3, root.bar);
		});
		it('Should move a text node to the parent VNode dom node', () => {
			const append = document.createElement('div');
			const div = document.createElement('div');
			const text = document.createTextNode('foo');
			div.appendChild(text);
			let vnode = v('div', [d({ node: text })]);
			const [Widget] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: append, sync: true });
			const root = append.childNodes[0] as any;
			assert.strictEqual(root.childNodes.length, 1);
			assert.strictEqual(div.childNodes.length, 0);
			assert.strictEqual((root.childNodes[0] as Text).data, 'foo');
		});
		it('Should not consider different dom nodes as the same', () => {
			const div = document.createElement('div');
			const divA = document.createElement('div');
			divA.innerHTML = 'A';
			const divB = document.createElement('div');
			divB.innerHTML = 'B';
			let vnode = d({ node: divA });
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: div, sync: true });
			let root = div.childNodes[0] as any;
			assert.strictEqual(root, divA);
			assert.strictEqual(root.innerHTML, 'A');
			vnode = d({ node: divB });
			meta.setRenderResult(vnode);
			root = div.childNodes[0] as any;
			assert.strictEqual(root, divB);
			assert.strictEqual(root.innerHTML, 'B');
		});
		it('Should run onAttach after the dom node has been appended to the dom', () => {
			let onAttachCallCount = 0;
			const myDomNode = document.createElement('div');
			const div = document.createElement('div');
			let vnode = d({
				node: myDomNode,
				onAttach: () => {
					onAttachCallCount++;
				}
			});
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: div, sync: true });
			assert.strictEqual(onAttachCallCount, 1);
			meta.setRenderResult(vnode);
			assert.strictEqual(onAttachCallCount, 1);
			meta.setRenderResult(null);
			assert.strictEqual(onAttachCallCount, 1);
			meta.setRenderResult(vnode);
			assert.strictEqual(onAttachCallCount, 2);
		});
		it('Should run onUpdate after the dom node has been updated in the dom', () => {
			let onUpdateCallCount = 0;
			const myDomNode = document.createElement('div');
			const div = document.createElement('div');
			let vnode = d({
				node: myDomNode,
				onUpdate: () => {
					onUpdateCallCount++;
				}
			});
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: div, sync: true });
			assert.strictEqual(onUpdateCallCount, 0);
			meta.setRenderResult(vnode);
			assert.strictEqual(onUpdateCallCount, 1);
			meta.setRenderResult(vnode);
			assert.strictEqual(onUpdateCallCount, 2);
			meta.setRenderResult(vnode);
			assert.strictEqual(onUpdateCallCount, 3);
		});
		it('Should run onDetach after the dom node has been removed from the dom', () => {
			let onDetachCallCount = 0;
			const myDomNode = document.createElement('div');
			const div = document.createElement('div');
			let vnode = d({
				node: myDomNode,
				onDetach: () => {
					onDetachCallCount++;
				}
			});
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: div, sync: true });
			assert.strictEqual(onDetachCallCount, 0);
			meta.setRenderResult(vnode);
			assert.strictEqual(onDetachCallCount, 0);
			meta.setRenderResult(null);
			assert.strictEqual(onDetachCallCount, 1);
			meta.setRenderResult(vnode);
			assert.strictEqual(onDetachCallCount, 1);
		});
		it('Should run onDetach after the dom node has been removed from the dom in nested dom node', () => {
			let onDetachCallCount = 0;
			const myDomNode = document.createElement('div');
			const div = document.createElement('div');
			let vnode = v('div', [
				d({
					node: myDomNode,
					onDetach: () => {
						onDetachCallCount++;
					}
				})
			]);
			const [Widget, meta] = getWidget(vnode);
			const r = renderer(() => w(Widget, {}));
			r.mount({ domNode: div, sync: true });
			assert.strictEqual(onDetachCallCount, 0);
			meta.setRenderResult(vnode);
			assert.strictEqual(onDetachCallCount, 0);
			meta.setRenderResult(null);
			assert.strictEqual(onDetachCallCount, 1);
			meta.setRenderResult(vnode);
			assert.strictEqual(onDetachCallCount, 1);
		});
	});

	describe('deferred properties', () => {
		let createElementStub: any;

		afterEach(() => {
			if (createElementStub) {
				createElementStub.restore();
			}
		});

		it('should only set properties and attributes that have changed for deferred properties', () => {
			class Foo extends WidgetBase {
				render() {
					return v('div', () => {
						return {
							foo: 'foo'
						};
					});
				}
			}
			let setAttributeSpy: SinonSpy;
			const div = document.createElement('div');
			const r = renderer(() => w(Foo, {}));
			const originalCreateElement = document.createElement.bind(document);
			createElementStub = stub(document, 'createElement');
			createElementStub.callsFake((name: string) => {
				const element = originalCreateElement(name);
				setAttributeSpy = spy(element, 'setAttribute');
				return element;
			});
			r.mount({ domNode: div });
			assert.isTrue(setAttributeSpy!.calledOnce);
			resolvers.resolve();
			assert.isTrue(setAttributeSpy!.calledOnce);
		});

		it('can call a callback on render and on the next rAF for vnode properties', () => {
			let deferredCallbackCount = 0;
			let renderCount = 0;

			const renderFunction = () => {
				renderCount++;
				const div = v('div', (inserted) => {
					return {
						inserted,
						deferredCallbackCount: ++deferredCallbackCount,
						key: 'prop'
					};
				});
				(div.properties as any).renderCount = renderCount;
				return div;
			};

			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			const root = div.childNodes[0] as any;

			assert.strictEqual(root.deferredCallbackCount, 1);
			assert.strictEqual(root.renderCount, 1);
			assert.isFalse(root.inserted);

			// resolve the rAF so deferred properties will run
			resolvers.resolve();

			assert.strictEqual(root.deferredCallbackCount, 2);
			assert.strictEqual(root.renderCount, 1);
			assert.isTrue(root.inserted);

			meta.setRenderResult(renderFunction());
			resolvers.resolve();
			resolvers.resolve();

			assert.strictEqual(div.childNodes[0], root);
			assert.strictEqual(root.deferredCallbackCount, 4);
			assert.strictEqual(root.renderCount, 2);
			assert.isTrue(root.inserted);
		});

		it('should still allow properties to be decorated on a DNode', () => {
			let foo = 'bar';

			const renderFunction = () => {
				const div = v('div', (inserted) => {
					return {
						foo: 'this should not override the decorated property',
						another: 'property'
					};
				});
				(div.properties as any).foo = foo;
				return div;
			};

			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			const root = div.childNodes[0] as HTMLElement;

			assert.strictEqual(root.getAttribute('foo'), 'bar');
			assert.strictEqual(root.getAttribute('another'), 'property');

			// resolve the rAF so deferred properties will run
			resolvers.resolve();

			assert.strictEqual(root.getAttribute('foo'), 'bar');
			assert.strictEqual(root.getAttribute('another'), 'property');

			foo = 'qux';

			meta.setRenderResult(renderFunction());

			resolvers.resolve();

			assert.strictEqual(root.getAttribute('foo'), 'qux');
			assert.strictEqual(root.getAttribute('another'), 'property');
		});
	});

	describe('events', () => {
		let sandbox: SinonSandbox;
		beforeEach(() => {
			sandbox = createSandbox();
		});
		afterEach(() => {
			sandbox.restore();
		});
		it('should add an event listener', () => {
			const onclick = stub();
			const renderFunction = () => {
				return v('div', { onclick });
			};
			const [Widget] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			sendEvent(root, 'click');
			assert.isTrue(onclick.called);
		});

		it('should be able to change event listener', () => {
			const onclickFirst = stub();
			const onclickSecond = stub();
			const renderFunction = (updated?: boolean) => {
				return v('div', { onclick: updated ? onclickSecond : onclickFirst });
			};
			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			sendEvent(root, 'click');
			assert.strictEqual(onclickFirst.callCount, 1);

			meta.setRenderResult(renderFunction(true));

			sendEvent(root, 'click');
			assert.strictEqual(onclickFirst.callCount, 1);
			assert.strictEqual(onclickSecond.callCount, 1);
		});

		it('should be able to drop an event listener across renders', () => {
			const onclick = stub();
			const renderFunction = (updated?: boolean) => {
				const props = updated ? {} : { onclick };
				return v('div', props);
			};
			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			sendEvent(root, 'click');
			assert.strictEqual(onclick.callCount, 1);

			meta.setRenderResult(renderFunction(true));

			sendEvent(root, 'click');
			assert.strictEqual(onclick.callCount, 1);

			meta.setRenderResult(renderFunction());

			sendEvent(root, 'click');
			assert.strictEqual(onclick.callCount, 2);
		});

		it('allows one to correct the value while being typed', () => {
			let typedKeys = '';
			const handleInput = (evt: any) => {
				typedKeys = evt.target.value.substr(0, 2);
			};
			const renderFunction = () => v('input', { value: typedKeys, oninput: handleInput });
			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLInputElement;
			assert.strictEqual(root.value, typedKeys);

			root.value = 'ab';
			sendEvent(root, 'input');
			assert.strictEqual(typedKeys, 'ab');
			meta.setRenderResult(renderFunction());

			assert.strictEqual(root.value, 'ab');

			root.value = 'abc';
			sendEvent(root, 'input');
			assert.strictEqual(typedKeys, 'ab');
			meta.setRenderResult(renderFunction());

			assert.strictEqual(root.value, 'ab');
		});

		it('does not undo keystrokes, even if a browser runs an animationFrame between changing the value property and running oninput', () => {
			// Crazy internet explorer behavior
			let typedKeys = '';
			const handleInput = (evt: Event) => {
				typedKeys = (evt.target as HTMLInputElement).value;
			};

			const renderFunction = () => v('input', { value: typedKeys, oninput: handleInput });

			const [Widget, meta] = getWidget(renderFunction());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLInputElement;
			assert.strictEqual(root.value, typedKeys);

			// Normal behavior
			root.value = 'a';
			sendEvent(root, 'input');
			assert.strictEqual(typedKeys, 'a');
			meta.setRenderResult(renderFunction());

			// Crazy behavior
			root.value = 'ab';
			meta.setRenderResult(renderFunction());

			assert.strictEqual(typedKeys, 'a');
			assert.strictEqual(root.value, 'ab');
			sendEvent(root, 'input');
			assert.strictEqual(typedKeys, 'ab');
			meta.setRenderResult(renderFunction());
		});

		it('should support passive oneventoptions', () => {
			let addEventListenerSpy: SinonStub;
			const createElement = document.createElement.bind(document);
			const createElementStub = sandbox.stub(document, 'createElement');
			createElementStub.callsFake((name: string) => {
				const element = createElement(name);
				addEventListenerSpy = stub(element, 'addEventListener');
				return element;
			});

			let invalidate: () => void;
			let passive = true;
			const onscroll = () => {};

			const MyWidget = create({ invalidator })(({ middleware: { invalidator } }) => {
				invalidate = invalidator;
				return (
					<div onscroll={onscroll} oneventoptions={{ passive: passive ? ['onscroll'] : [] }}>
						Hello
					</div>
				);
			});

			const root: HTMLElement = document.createElement('div');
			const r = renderer(() => <MyWidget />);

			// force support of passive events
			add('dom-passive-event', true, true);
			r.mount({ domNode: root, sync: true });

			let [, , eventOptions] = addEventListenerSpy!.firstCall.args;
			assert.deepEqual(eventOptions, { passive: true });
			passive = false;
			invalidate!();
			[, , eventOptions] = addEventListenerSpy!.secondCall.args;
			assert.deepEqual(eventOptions, { passive: false });

			// force non-support of passive events
			add('dom-passive-event', false, true);
			passive = true;
			invalidate!();
			[, , eventOptions] = addEventListenerSpy!.thirdCall.args;
			assert.deepEqual(eventOptions, undefined);
		});

		it('should not re-attach event listeners for the same type if the callback changes', () => {
			let addEventListenerSpy: SinonStub;
			const createElement = document.createElement.bind(document);
			const createElementStub = sandbox.stub(document, 'createElement');
			createElementStub.callsFake((name: string) => {
				const element = createElement(name);
				addEventListenerSpy = stub(element, 'addEventListener');
				return element;
			});

			let invalidate: () => void;
			const MyWidget = create({ invalidator })(({ middleware: { invalidator } }) => {
				invalidate = invalidator;
				return <div onclick={() => {}}>Hello</div>;
			});

			const root: HTMLElement = document.createElement('div');
			const r = renderer(() => <MyWidget />);
			r.mount({ domNode: root, sync: true });
			assert.equal(addEventListenerSpy!.callCount, 1);
			invalidate!();
			assert.equal(addEventListenerSpy!.callCount, 1);
		});
	});

	describe('children', () => {
		it('can remove child nodes', () => {
			const [Widget, meta] = getWidget(
				v('div', [v('span', { key: 1 }), v('span', { key: 2 }), v('span', { key: 3 })])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.lengthOf(root.childNodes, 3);
			const firstSpan = root.childNodes[0];
			const lastSpan = root.childNodes[2];
			meta.setRenderResult(v('div', [v('span', { key: 1 }), v('span', { key: 3 })]));
			assert.lengthOf(root.childNodes, 2);
			assert.strictEqual(root.childNodes[0], firstSpan);
			assert.strictEqual(root.childNodes[1], lastSpan);
			meta.setRenderResult(v('div', [v('span', { key: 3 })]));
			assert.lengthOf(root.childNodes, 1);
			assert.strictEqual(root.childNodes[0], lastSpan);
			meta.setRenderResult(v('div'));
			assert.lengthOf(root.childNodes, 0);
		});

		it('can add child nodes', () => {
			const [Widget, meta] = getWidget(v('div', [v('span', { key: 2 }), v('span', { key: 4 })]));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.lengthOf(root.childNodes, 2);
			const firstSpan = root.childNodes[0];
			const lastSpan = root.childNodes[1];

			meta.setRenderResult(
				v('div', [
					v('span', { key: 1 }),
					v('span', { key: 2 }),
					v('span', { key: 3 }),
					v('span', { key: 4 }),
					v('span', { key: 5 })
				])
			);

			assert.lengthOf(root.childNodes, 5);
			assert.strictEqual(root.childNodes[1], firstSpan);
			assert.strictEqual(root.childNodes[3], lastSpan);
		});

		it('can distinguish between string keys when adding', () => {
			const [Widget, meta] = getWidget(v('div', [v('span', { key: 'one' }), v('span', { key: 'three' })]));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.lengthOf(root.childNodes, 2);
			const firstSpan = root.childNodes[0];
			const secondSpan = root.childNodes[1];

			meta.setRenderResult(
				v('div', [v('span', { key: 'one' }), v('span', { key: 'two' }), v('span', { key: 'three' })])
			);

			assert.lengthOf(root.childNodes, 3);
			assert.strictEqual(root.childNodes[0], firstSpan);
			assert.strictEqual(root.childNodes[2], secondSpan);
		});

		it('can distinguish between falsy keys when replacing', () => {
			const [Widget, meta] = getWidget(
				v('div', [
					v('span', { id: 'false', key: false as any }),
					v('span', { id: 'null', key: null as any }),
					v('span', { id: 'empty', key: '' }),
					v('span', { id: 'none' })
				])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;

			assert.lengthOf(root.childNodes, 4);

			const firstSpan = root.childNodes[0];
			const secondSpan = root.childNodes[1];
			const thirdSpan = root.childNodes[2];
			const fourthSpan = root.childNodes[3];

			meta.setRenderResult(v('div', [v('span', { id: 'zero', key: 0 })]));

			assert.lengthOf(root.childNodes, 1);
			const newSpan = root.childNodes[0];

			assert.notStrictEqual(newSpan, firstSpan);
			assert.notStrictEqual(newSpan, secondSpan);
			assert.notStrictEqual(newSpan, thirdSpan);
			assert.notStrictEqual(newSpan, fourthSpan);
		});

		it('can distinguish between string keys when deleting', () => {
			const [Widget, meta] = getWidget(
				v('div', [v('span', { key: 'one' }), v('span', { key: 'two' }), v('span', { key: 'three' })])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.lengthOf(root.childNodes, 3);
			const firstSpan = root.childNodes[0];
			const thirdSpan = root.childNodes[2];

			meta.setRenderResult(v('div', [v('span', { key: 'one' }), v('span', { key: 'three' })]));

			assert.lengthOf(root.childNodes, 2);
			assert.strictEqual(root.childNodes[0], firstSpan);
			assert.strictEqual(root.childNodes[1], thirdSpan);
		});

		it('can distinguish between falsy keys when deleting', () => {
			const [Widget, meta] = getWidget(
				v('div', [v('span', { key: 0 }), v('span', { key: false as any }), v('span', { key: null as any })])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;

			assert.lengthOf(root.childNodes, 3);
			const firstSpan = root.childNodes[0];
			const thirdSpan = root.childNodes[2];

			meta.setRenderResult(v('div', [v('span', { key: 0 }), v('span', { key: null as any })]));

			assert.lengthOf(root.childNodes, 2);
			assert.strictEqual(root.childNodes[0], firstSpan);
			assert.strictEqual(root.childNodes[1], thirdSpan);
		});

		it('does not reorder nodes based on keys', () => {
			const [Widget, meta] = getWidget(
				v('div', [
					v('span', { key: 'a', id: 'a' }),
					v('span', { key: '1', id: '1' }),
					v('span', { key: '2', id: '2' }),
					v('span', { key: '3', id: '3' }),
					v('span', { key: '4', id: '4' }),
					v('span', { key: '5', id: '5' }),
					v('span', { key: '6', id: '6' }),
					v('span', { key: '7', id: '7' }),
					v('span', { key: 'b', id: 'b' })
				])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;

			assert.lengthOf(root.childNodes, 9);
			const firstSpan = root.firstChild;
			const lastSpan = root.lastChild;

			meta.setRenderResult(
				v('div', [
					v('span', { key: 'b', id: 'b' }),
					v('span', { key: '1', id: '1' }),
					v('span', { key: '2', id: '2' }),
					v('span', { key: '3', id: '3' }),
					v('span', { key: '4', id: '4' }),
					v('span', { key: '5', id: '5' }),
					v('span', { key: '6', id: '6' }),
					v('span', { key: '7', id: '7' }),
					v('span', { key: 'a', id: 'a' })
				])
			);
			assert.lengthOf(root.childNodes, 9);
			assert.strictEqual(root.firstChild, lastSpan);
			assert.strictEqual(root.lastChild, firstSpan);
		});

		it('can insert text nodes', () => {
			const [Widget, meta] = getWidget(v('div', [v('span', { key: 2 }), v('span', { key: 4 })]));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;

			assert.lengthOf(root.childNodes, 2);
			const firstSpan = root.childNodes[0];
			const lastSpan = root.childNodes[1];

			meta.setRenderResult(v('div', [v('span', { key: 2 }), 'Text between', v('span', { key: 4 })]));

			assert.lengthOf(root.childNodes, 3);

			assert.strictEqual(root.childNodes[0], firstSpan);
			assert.strictEqual(root.childNodes[2], lastSpan);
		});

		it('Can update, insert and remove only affected vnodes', () => {
			let onDetachStub = stub();
			class Other extends WidgetBase {
				onDetach() {
					onDetachStub();
				}
				render() {
					const { key } = this.properties;
					return v('div', { key });
				}
			}
			const [Widget, meta] = getWidget(
				v('div', [
					v('span', { key: '1', id: '1' }),
					v('span', { key: '2', id: '2' }),
					v('span', { key: '3', id: '3' }),
					v('span', { key: '4', id: '4' }),
					v('span', { key: '5', id: '5' }),
					v('span', { key: '6', id: '6' }),
					v('span', { key: '7', id: '7' }),
					v('span', { key: '8', id: '8' }, [w(Other, { key: 'widget-8' })]),
					v('span', { key: '9', id: '9' }),
					v('span', { key: '10', id: '10' }),
					v('span', { key: '11', id: '11' }),
					v('span', { key: '12', id: '12' })
				])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			const childOne = root.childNodes[0] as HTMLSpanElement;
			const childTwo = root.childNodes[1] as HTMLSpanElement;
			const childThree = root.childNodes[2] as HTMLSpanElement;
			const childFour = root.childNodes[3] as HTMLSpanElement;
			const childFive = root.childNodes[4] as HTMLSpanElement;
			const childSix = root.childNodes[5] as HTMLSpanElement;
			const childSeven = root.childNodes[6] as HTMLSpanElement;
			const childEight = root.childNodes[7] as HTMLSpanElement;
			const childNine = root.childNodes[8] as HTMLSpanElement;
			const childTen = root.childNodes[9] as HTMLSpanElement;
			const childEleven = root.childNodes[10] as HTMLSpanElement;
			const childTwelve = root.childNodes[11] as HTMLSpanElement;
			meta.setRenderResult(
				v('div', [
					v('span', { key: '1', id: '1' }),
					v('span', { key: '8', id: '8' }),
					v('span', { key: '9', id: '9' }),
					v('span', { key: '10', id: '10' }),
					v('span', { key: '6', id: '6' }),
					v('span', { key: '15', id: '15' }),
					v('span', { key: '16', id: '16' }),
					v('span', { key: '17', id: '17' }),
					v('span', { key: '18', id: '18' }),
					v('span', { key: '7', id: '7', href: 'href' }),
					v('span', { key: '2', id: '2' }),
					v('span', { key: '3', id: '3' }),
					v('span', { key: '4', id: '4' }),
					v('span', { key: '11', id: '11' }),
					v('span', { key: '12', id: '12' }),
					v('span', { key: '13', id: '13' })
				])
			);

			assert.lengthOf(root.childNodes, 16);
			assert.strictEqual(root.childNodes[0], childOne);
			assert.strictEqual(root.childNodes[1], childEight);
			assert.strictEqual(root.childNodes[2], childNine);
			assert.strictEqual(root.childNodes[3], childTen);
			assert.strictEqual(root.childNodes[4], childSix);
			assert.strictEqual(root.childNodes[9], childSeven);
			assert.strictEqual((root.childNodes[9] as HTMLElement).getAttribute('href'), 'href');
			assert.strictEqual(root.childNodes[10], childTwo);
			assert.strictEqual(root.childNodes[11], childThree);
			assert.strictEqual(root.childNodes[12], childFour);
			assert.isNull(childFive.parentNode);
			assert.strictEqual(root.childNodes[13], childEleven);
			assert.strictEqual(root.childNodes[14], childTwelve);
			assert.strictEqual(onDetachStub.callCount, 1);
		});

		it('Can update, insert and remove only affected nodes from widgets', () => {
			class Other extends WidgetBase {
				render() {
					const { key } = this.properties;
					return v('div', { key });
				}
			}

			class Foo extends WidgetBase<{ id?: string; href?: string; show?: boolean }> {
				render() {
					const { key, id, href, show = true } = this.properties;
					if (!show) {
						return null;
					}
					let properties = href ? { key, id, href } : { key, id };
					return v('span', properties, [v('span', { id: `child-${id}` }), w(Other, { key: `widget-${id}` })]);
				}
			}

			const [Widget, meta] = getWidget(
				v('div', [
					w(Foo, { key: '1', id: '1' }),
					w(Foo, { key: '2', id: '2' }),
					w(Foo, { key: '3', id: '3' }),
					w(Foo, { key: '4', id: '4' }),
					w(Foo, { key: '5', id: '5' }),
					w(Foo, { key: '6', id: '6' }),
					w(Foo, { key: '7', id: '7' }),
					w(Foo, { key: '8', id: '8' }),
					w(Foo, { key: '9', id: '9' }),
					w(Foo, { key: '10', id: '10' }),
					w(Foo, { key: '11', id: '11' }),
					w(Foo, { key: '12', id: '12' })
				])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			const root = div.childNodes[0] as HTMLElement;
			const childOne = root.childNodes[0] as HTMLSpanElement;
			const childTwo = root.childNodes[1] as HTMLSpanElement;
			const childThree = root.childNodes[2] as HTMLSpanElement;
			const childFour = root.childNodes[3] as HTMLSpanElement;
			const childFive = root.childNodes[4] as HTMLSpanElement;
			const childSix = root.childNodes[5] as HTMLSpanElement;
			const childSeven = root.childNodes[6] as HTMLSpanElement;
			const childEight = root.childNodes[7] as HTMLSpanElement;
			const childNine = root.childNodes[8] as HTMLSpanElement;
			const childTen = root.childNodes[9] as HTMLSpanElement;
			const childEleven = root.childNodes[10] as HTMLSpanElement;
			const childTwelve = root.childNodes[11] as HTMLSpanElement;

			meta.setRenderResult(
				v('div', [
					w(Foo, { key: '1', id: '1' }),
					w(Foo, { key: '8', id: '8' }),
					w(Foo, { key: '9', id: '9' }),
					w(Foo, { key: '10', id: '10' }),
					w(Foo, { key: '6', id: '6' }),
					w(Foo, { key: '15', id: '15' }),
					w(Foo, { key: '16', id: '16' }),
					w(Foo, { key: '17', id: '17' }),
					w(Foo, { key: '18', id: '18' }),
					w(Foo, { key: '7', id: '7', href: 'href' }),
					w(Foo, { key: '2', id: '2' }),
					w(Foo, { key: '3', id: '3' }),
					w(Foo, { key: '4', id: '4' }),
					w(Foo, { key: '11', id: '11' }),
					w(Foo, { key: '12', id: '12' }),
					w(Foo, { key: '13', id: '13' })
				])
			);
			resolvers.resolve();
			resolvers.resolve();
			assert.lengthOf(root.childNodes, 16);
			assert.strictEqual(root.childNodes[0], childOne);
			assert.strictEqual(root.childNodes[0].childNodes[0], childOne.childNodes[0]);
			assert.strictEqual(root.childNodes[0].childNodes[1], childOne.childNodes[1]);
			assert.strictEqual(root.childNodes[1], childEight);
			assert.strictEqual(root.childNodes[1].childNodes[0], childEight.childNodes[0]);
			assert.strictEqual(root.childNodes[1].childNodes[1], childEight.childNodes[1]);
			assert.strictEqual(root.childNodes[2], childNine);
			assert.strictEqual(root.childNodes[2].childNodes[0], childNine.childNodes[0]);
			assert.strictEqual(root.childNodes[2].childNodes[1], childNine.childNodes[1]);
			assert.strictEqual(root.childNodes[3], childTen);
			assert.strictEqual(root.childNodes[3].childNodes[0], childTen.childNodes[0]);
			assert.strictEqual(root.childNodes[3].childNodes[1], childTen.childNodes[1]);
			assert.strictEqual(root.childNodes[4], childSix);
			assert.strictEqual(root.childNodes[4].childNodes[0], childSix.childNodes[0]);
			assert.strictEqual(root.childNodes[4].childNodes[1], childSix.childNodes[1]);
			assert.strictEqual(root.childNodes[9], childSeven);
			assert.strictEqual(root.childNodes[9].childNodes[0], childSeven.childNodes[0]);
			assert.strictEqual(root.childNodes[9].childNodes[1], childSeven.childNodes[1]);
			assert.strictEqual(root.childNodes[10], childTwo);
			assert.strictEqual(root.childNodes[10].childNodes[0], childTwo.childNodes[0]);
			assert.strictEqual(root.childNodes[10].childNodes[1], childTwo.childNodes[1]);
			assert.strictEqual(root.childNodes[11], childThree);
			assert.strictEqual(root.childNodes[11].childNodes[0], childThree.childNodes[0]);
			assert.strictEqual(root.childNodes[11].childNodes[1], childThree.childNodes[1]);
			assert.strictEqual(root.childNodes[12], childFour);
			assert.strictEqual(root.childNodes[12].childNodes[0], childFour.childNodes[0]);
			assert.strictEqual(root.childNodes[12].childNodes[1], childFour.childNodes[1]);
			assert.strictEqual(root.childNodes[13], childEleven);
			assert.strictEqual(root.childNodes[13].childNodes[0], childEleven.childNodes[0]);
			assert.strictEqual(root.childNodes[13].childNodes[1], childEleven.childNodes[1]);
			assert.strictEqual(root.childNodes[14], childTwelve);
			assert.strictEqual(root.childNodes[14].childNodes[0], childTwelve.childNodes[0]);
			assert.strictEqual(root.childNodes[14].childNodes[1], childTwelve.childNodes[1]);
			assert.notDeepInclude(arrayFrom(root.children), childFive);
		});

		it('Can insert new nodes in a widget that returns an array from render', () => {
			let addExtraNodes: any = undefined;

			class A extends WidgetBase<any> {
				render() {
					if (this.properties.extra) {
						return [
							v('div', { key: '1' }, ['1']),
							v('div', { key: '2' }, ['2']),
							v('div', { key: '3' }, ['3'])
						];
					}
					return [v('div', { key: '1' }, ['1'])];
				}
			}

			class B extends WidgetBase {
				private _extraNodes = false;
				private a = () => {
					this._extraNodes = !this._extraNodes;
					this.invalidate();
				};
				constructor() {
					super();
					addExtraNodes = this.a;
				}
				render() {
					return v('div', [w(A, { extra: this._extraNodes }), w(A, {})]);
				}
			}
			const r = renderer(() => w(B, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '1');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '1');
			addExtraNodes();
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '1');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '2');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '3');
			assert.strictEqual((root.childNodes[3].childNodes[0] as Text).data, '1');
		});

		it('Can insert new nodes in a widget that returns an array from render when previously returns null', () => {
			let addExtraNodes: any = undefined;

			class A extends WidgetBase<any> {
				render() {
					if (this.properties.extra) {
						return [
							v('div', { key: '1' }, ['1']),
							v('div', { key: '2' }, ['2']),
							v('div', { key: '3' }, ['3'])
						];
					}
					return [null];
				}
			}

			class C extends WidgetBase {
				render() {
					return [
						v('div', { key: '1' }, ['4']),
						v('div', { key: '2' }, ['5']),
						v('div', { key: '3' }, ['6'])
					];
				}
			}

			class B extends WidgetBase {
				private _extraNodes = false;
				private a = () => {
					this._extraNodes = !this._extraNodes;
					this.invalidate();
				};
				constructor() {
					super();
					addExtraNodes = this.a;
				}
				render() {
					return v('div', [w(C, {}), w(A, { extra: this._extraNodes }), w(C, {})]);
				}
			}

			const r = renderer(() => w(B, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '6');
			assert.strictEqual((root.childNodes[3].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[4].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[5].childNodes[0] as Text).data, '6');
			addExtraNodes();
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '6');
			assert.strictEqual((root.childNodes[3].childNodes[0] as Text).data, '1');
			assert.strictEqual((root.childNodes[4].childNodes[0] as Text).data, '2');
			assert.strictEqual((root.childNodes[5].childNodes[0] as Text).data, '3');
			assert.strictEqual((root.childNodes[6].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[7].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[8].childNodes[0] as Text).data, '6');
		});

		it('Can insert new nodes in first widget that returns an array from render when previously returns null', () => {
			let addExtraNodes: any = undefined;

			class A extends WidgetBase<any> {
				render() {
					if (this.properties.extra) {
						return [
							v('div', { key: '1' }, ['1']),
							v('div', { key: '2' }, ['2']),
							v('div', { key: '3' }, ['3'])
						];
					}
					return [null];
				}
			}

			class C extends WidgetBase {
				render() {
					return [
						v('div', { key: '1' }, ['4']),
						v('div', { key: '2' }, ['5']),
						v('div', { key: '3' }, ['6'])
					];
				}
			}

			class B extends WidgetBase {
				private _extraNodes = false;
				private a = () => {
					this._extraNodes = !this._extraNodes;
					this.invalidate();
				};
				constructor() {
					super();
					addExtraNodes = this.a;
				}
				render() {
					return v('div', [w(A, { extra: this._extraNodes }), w(C, {})]);
				}
			}
			const r = renderer(() => w(B, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '6');
			addExtraNodes();
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '1');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '2');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '3');
			assert.strictEqual((root.childNodes[3].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[4].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[5].childNodes[0] as Text).data, '6');
		});

		it('Can insert new nodes in last widget that returns an array from render when previously returns null', () => {
			let addExtraNodes: any = undefined;

			class A extends WidgetBase<any> {
				render() {
					if (this.properties.extra) {
						return [
							v('div', { key: '1' }, ['1']),
							v('div', { key: '2' }, ['2']),
							v('div', { key: '3' }, ['3'])
						];
					}
					return [null];
				}
			}

			class C extends WidgetBase {
				render() {
					return [
						v('div', { key: '1' }, ['4']),
						v('div', { key: '2' }, ['5']),
						v('div', { key: '3' }, ['6'])
					];
				}
			}

			class B extends WidgetBase {
				private _extraNodes = false;
				private a = () => {
					this._extraNodes = !this._extraNodes;
					this.invalidate();
				};
				constructor() {
					super();
					addExtraNodes = this.a;
				}
				render() {
					return v('div', [w(C, {}), w(A, { extra: this._extraNodes })]);
				}
			}
			const r = renderer(() => w(B, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '6');
			addExtraNodes();
			assert.strictEqual((root.childNodes[0].childNodes[0] as Text).data, '4');
			assert.strictEqual((root.childNodes[1].childNodes[0] as Text).data, '5');
			assert.strictEqual((root.childNodes[2].childNodes[0] as Text).data, '6');
			assert.strictEqual((root.childNodes[3].childNodes[0] as Text).data, '1');
			assert.strictEqual((root.childNodes[4].childNodes[0] as Text).data, '2');
			assert.strictEqual((root.childNodes[5].childNodes[0] as Text).data, '3');
		});

		it('can update single text nodes', () => {
			const [Widget, meta] = getWidget(v('span', ['']));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;
			assert.lengthOf(root.childNodes, 0);

			meta.setRenderResult(v('span', [undefined]));

			assert.lengthOf(root.childNodes, 0);

			meta.setRenderResult(v('span', ['f']));

			assert.lengthOf(root.childNodes, 1);

			meta.setRenderResult(v('span', [null]));

			assert.lengthOf(root.childNodes, 0);

			meta.setRenderResult(v('span', ['']));

			assert.lengthOf(root.childNodes, 0);

			meta.setRenderResult(v('span', [' ']));

			assert.lengthOf(root.childNodes, 1);
		});

		it('Assumes text node where tag is falsy and there is text in the VNode', () => {
			const textVNode: VNode = {
				tag: undefined as any,
				properties: {},
				children: undefined,
				text: 'text-node',
				type: '__VNODE_TYPE'
			};
			const [Widget, meta] = getWidget(textVNode);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			let root = div.childNodes[0] as Text;
			assert.strictEqual(root.data, 'text-node');
			meta.setRenderResult({
				tag: undefined as any,
				properties: {},
				children: undefined,
				text: 'text-other',
				type: '__VNODE_TYPE'
			});
			root = div.childNodes[0] as Text;
			assert.strictEqual(root.data, 'text-other');
		});

		it('Will append text node when VNode has a domNode with no parentNode', () => {
			const domNode = document.createTextNode('text-node');
			const textVNode = {
				tag: undefined as any,
				properties: {},
				children: undefined,
				text: 'text-node',
				domNode,
				type: '__VNODE_TYPE'
			};
			const [Widget] = getWidget(textVNode);
			const r = renderer(() => w(Widget, {}));
			const root = document.createElement('div');
			r.mount({ domNode: root, sync: true });
			const textNode = root.childNodes[0] as Text;
			assert.strictEqual(textNode.data, 'text-node');
			assert.strictEqual(textNode, domNode);
		});

		it('Should ignore vnode with no tag or text', () => {
			const domNode = document.createTextNode('text-node');
			const textVNode = {
				tag: undefined as any,
				properties: {},
				children: undefined,
				text: undefined,
				domNode,
				type: '__VNODE_TYPE'
			};
			const [Widget, meta] = getWidget(textVNode);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			let textNode = div.childNodes[0] as Text;
			assert.strictEqual(textNode, domNode);
			meta.setRenderResult({ ...textVNode } as any);
			textNode = div.childNodes[0] as Text;
			assert.strictEqual(textNode, domNode);
		});

		it('allows a contentEditable tag to be altered', () => {
			let text = 'initial value';
			const handleInput = (evt: any) => {
				text = evt.currentTarget.innerHTML;
			};
			const renderDNodes = () =>
				v('div', {
					contentEditable: true,
					oninput: handleInput,
					innerHTML: text
				});
			const [Widget, meta] = getWidget(renderDNodes());
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const root = div.childNodes[0] as HTMLElement;

			root.removeChild(root.childNodes[0]);
			handleInput({ currentTarget: div.childNodes[0] as Element });
			meta.setRenderResult(renderDNodes());

			root.innerHTML = 'changed <i>value</i>';
			handleInput({ currentTarget: div.childNodes[0] as Element });
			meta.setRenderResult(renderDNodes());

			assert.strictEqual(root.innerHTML, 'changed <i>value</i>');
		});
	});

	describe('svg', () => {
		it('creates and updates svg dom nodes with the right namespace', () => {
			const [Widget, meta] = getWidget(
				v('div', [
					v('svg', [
						v('circle', { cx: '2cm', cy: '2cm', r: '1cm', fill: 'red' }),
						v('image', { href: '/image.jpeg' })
					]),
					v('span')
				])
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const svg = (div.childNodes[0] as Element).childNodes[0];
			assert.strictEqual(svg.namespaceURI, 'http://www.w3.org/2000/svg');
			const circle = svg.childNodes[0];
			assert.strictEqual(circle.namespaceURI, 'http://www.w3.org/2000/svg');
			const image = svg.childNodes[1] as HTMLImageElement;
			assert.strictEqual(image.attributes[0].namespaceURI, 'http://www.w3.org/1999/xlink');
			const span = (div.childNodes[0] as Element).childNodes[1];
			assert.strictEqual(span.namespaceURI, 'http://www.w3.org/1999/xhtml');

			meta.setRenderResult(
				v('div', [
					v('svg', [
						v('circle', { key: 'blue', cx: '2cm', cy: '2cm', r: '1cm', fill: 'blue' }),
						v('image', { href: '/image2.jpeg' })
					]),
					v('span')
				])
			);

			const blueCircle = svg.childNodes[0];
			assert.strictEqual(blueCircle.namespaceURI, 'http://www.w3.org/2000/svg');
		});

		it('should support adding and removing classes on svg dom', () => {
			const [Widget, meta] = getWidget(v('svg', { classes: ['foo'] }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			const svg = div.childNodes[0] as SVGElement;
			assert.strictEqual(svg.namespaceURI, 'http://www.w3.org/2000/svg');
			assert.strictEqual(svg.getAttribute('class'), 'foo');
			meta.setRenderResult(v('svg', { classes: ['foo', 'bar'] }));
			assert.strictEqual(svg.getAttribute('class'), 'foo bar');
			meta.setRenderResult(v('svg', { classes: [] }));
			assert.strictEqual(svg.getAttribute('class'), null);
			meta.setRenderResult(v('svg', { classes: ['bar'] }));
			assert.strictEqual(svg.getAttribute('class'), 'bar');
		});
	});

	describe('merging', () => {
		it('Supports merging DNodes onto existing HTML', () => {
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(
				`<div class="foo"><label for="baz">Select Me:</label><select type="text" name="baz" id="baz" disabled="disabled"><option value="foo">label foo</option><option value="bar" selected="">label bar</option><option value="baz">label baz</option></select><button type="button" disabled="disabled">Click Me!</button></div>`
			);
			iframe.contentDocument!.close();
			const root = iframe.contentDocument!.body.firstChild as HTMLElement;
			const childElementCount = root.childElementCount;
			const select = root.childNodes[1] as HTMLSelectElement;
			const button = root.childNodes[2] as HTMLButtonElement;
			assert.strictEqual(select.value, 'bar', 'bar should be selected');
			const onclickListener = spy();
			class Foo extends WidgetBase {
				render() {
					return v(
						'div',
						{
							classes: ['foo', 'bar']
						},
						[
							v(
								'label',
								{
									for: 'baz'
								},
								['Select Me:']
							),
							v(
								'select',
								{
									type: 'text',
									name: 'baz',
									id: 'baz',
									disabled: false
								},
								[
									v('option', { value: 'foo', selected: true }, ['label foo']),
									v('option', { value: 'bar', selected: false }, ['label bar']),
									v('option', { value: 'baz', selected: false }, ['label baz'])
								]
							),
							v(
								'button',
								{
									type: 'button',
									disabled: false,
									onclick: onclickListener
								},
								['Click Me!']
							)
						]
					);
				}
			}
			const r = renderer(() => w(Foo, {}));
			r.mount({ domNode: iframe.contentDocument!.body });
			assert.strictEqual(root.className, 'foo bar', 'should have added bar class');
			assert.strictEqual(root.childElementCount, childElementCount, 'should have the same number of children');
			assert.strictEqual(select, root.childNodes[1], 'should have been reused');
			assert.strictEqual(button, root.childNodes[2], 'should have been reused');
			assert.isFalse(select.disabled, 'select should be enabled');
			assert.isFalse(button.disabled, 'button should be enabled');
			assert.strictEqual(select.value, 'foo', 'foo should be selected');
			assert.strictEqual(select.children.length, 3, 'should have 3 children');
			assert.isFalse(onclickListener.called, 'onclickListener should not have been called');
			const clickEvent = document.createEvent('CustomEvent');
			clickEvent.initEvent('click', true, true);
			button.dispatchEvent(clickEvent);
			assert.isTrue(onclickListener.called, 'onclickListener should have been called');
			document.body.removeChild(iframe);
		});
		it('Supports merging DNodes with widgets onto existing HTML', () => {
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(
				`<div class="foo"><label for="baz">Select Me:</label><select type="text" name="baz" id="baz" disabled="disabled"><option value="foo">label foo</option><option value="bar" selected="">label bar</option><option value="baz">label baz</option></select><button type="button" disabled="disabled">Click Me!</button><span>label</span><div>last node</div></div>`
			);
			iframe.contentDocument!.close();
			const root = iframe.contentDocument!.body.firstChild as HTMLElement;
			const childElementCount = root.childElementCount;
			const label = root.childNodes[0] as HTMLLabelElement;
			const select = root.childNodes[1] as HTMLSelectElement;
			const button = root.childNodes[2] as HTMLButtonElement;
			const span = root.childNodes[3] as HTMLElement;
			const div = root.childNodes[4] as HTMLElement;
			assert.strictEqual(select.value, 'bar', 'bar should be selected');
			const onclickListener = spy();
			class Button extends WidgetBase {
				render() {
					return [
						v('button', { type: 'button', disabled: false, onclick: onclickListener }, ['Click Me!']),
						v('span', {}, ['label'])
					];
				}
			}
			class Foo extends WidgetBase {
				render() {
					return v(
						'div',
						{
							classes: ['foo', 'bar']
						},
						[
							v(
								'label',
								{
									for: 'baz'
								},
								['Select Me:']
							),
							v(
								'select',
								{
									type: 'text',
									name: 'baz',
									id: 'baz',
									disabled: false
								},
								[
									v('option', { value: 'foo', selected: true }, ['label foo']),
									v('option', { value: 'bar', selected: false }, ['label bar']),
									v('option', { value: 'baz', selected: false }, ['label baz'])
								]
							),
							w(Button, {}),
							v('div', ['last node'])
						]
					);
				}
			}
			const r = renderer(() => w(Foo, {}));
			r.mount({ domNode: iframe.contentDocument!.body });
			assert.strictEqual(root.className, 'foo bar', 'should have added bar class');
			assert.strictEqual(root.childElementCount, childElementCount, 'should have the same number of children');
			assert.strictEqual(label, root.childNodes[0], 'should have been reused');
			assert.strictEqual(select, root.childNodes[1], 'should have been reused');
			assert.strictEqual(button, root.childNodes[2], 'should have been reused');
			assert.strictEqual(span, root.childNodes[3], 'should have been reused');
			assert.strictEqual(div, root.childNodes[4], 'should have been reused');
			assert.isFalse(select.disabled, 'select should be enabled');
			assert.isFalse(button.disabled, 'button should be enabled');
			assert.strictEqual(select.value, 'foo', 'foo should be selected');
			assert.strictEqual(select.children.length, 3, 'should have 3 children');
			assert.isFalse(onclickListener.called, 'onclickListener should not have been called');
			const clickEvent = document.createEvent('CustomEvent');
			clickEvent.initEvent('click', true, true);
			button.dispatchEvent(clickEvent);
			assert.isTrue(onclickListener.called, 'onclickListener should have been called');
			document.body.removeChild(iframe);
		});
		it('supports merging svg nodes', () => {
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(`<div><svg></svg></div>`);
			iframe.contentDocument!.close();
			const root = iframe.contentDocument!.body.firstChild as HTMLElement;
			const svg = root.childNodes[0];
			class Foo extends WidgetBase {
				render() {
					return v('div', [v('svg')]);
				}
			}
			const r = renderer(() => w(Foo, {}));
			r.mount({ domNode: iframe.contentDocument!.body });
			assert.strictEqual(root.childNodes[0], svg);
		});
		it('supports inserting before nodes that are not merged', () => {
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(`<div><div></div></div>`);
			iframe.contentDocument!.close();
			const root = iframe.contentDocument!.body.firstChild as HTMLElement;
			const span = root.childNodes[0];
			class Foo extends WidgetBase {
				render() {
					return v('div', [v('span')]);
				}
			}
			const r = renderer(() => w(Foo, {}));
			r.mount({ domNode: iframe.contentDocument!.body });
			assert.notStrictEqual(root.childNodes[0], span);
		});
		it('Removes unknown nodes when merging', () => {
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(`
				<div class="foo">
					<label for="baz">Select Me:</label>
					<select type="text" name="baz" id="baz" disabled="disabled">
						<option value="foo">label foo</option>
						<option value="bar" selected="">label bar</option>
						<option value="baz">label baz</option>
					</select>
					<button type="button" disabled="disabled">Click Me!</button>
					<span>label</span>
					<div>last node</div>
				</div>`);
			iframe.contentDocument!.close();
			const root = iframe.contentDocument!.body.firstChild as HTMLElement;
			const childElementCount = root.childElementCount;
			const label = root.childNodes[1] as HTMLLabelElement;
			const select = root.childNodes[3] as HTMLSelectElement;
			const button = root.childNodes[5] as HTMLButtonElement;
			const span = root.childNodes[7] as HTMLElement;
			const div = root.childNodes[9] as HTMLElement;
			assert.strictEqual(select.value, 'bar', 'bar should be selected');
			const onclickListener = spy();
			class Button extends WidgetBase {
				render() {
					return [
						v('button', { type: 'button', disabled: false, onclick: onclickListener }, ['Click Me!']),
						v('span', {}, ['label'])
					];
				}
			}
			class Foo extends WidgetBase {
				render() {
					return v(
						'div',
						{
							classes: ['foo', 'bar']
						},
						[
							v(
								'label',
								{
									for: 'baz'
								},
								['Select Me:']
							),
							v(
								'select',
								{
									type: 'text',
									name: 'baz',
									id: 'baz',
									disabled: false
								},
								[
									v('option', { value: 'foo', selected: true }, ['label foo']),
									v('option', { value: 'bar', selected: false }, ['label bar']),
									v('option', { value: 'baz', selected: false }, ['label baz'])
								]
							),
							w(Button, {}),
							v('div', ['last node'])
						]
					);
				}
			}
			const r = renderer(() => w(Foo, {}));
			r.mount({ domNode: iframe.contentDocument!.body });
			assert.strictEqual(root.className, 'foo bar', 'should have added bar class');
			assert.strictEqual(root.childElementCount, childElementCount, 'should have the same number of children');
			assert.strictEqual(label, root.childNodes[0], 'should have been reused');
			assert.strictEqual(select, root.childNodes[1], 'should have been reused');
			assert.strictEqual(button, root.childNodes[2], 'should have been reused');
			assert.strictEqual(span, root.childNodes[3], 'should have been reused');
			assert.strictEqual(div, root.childNodes[4], 'should have been reused');
			assert.isFalse(select.disabled, 'select should be enabled');
			assert.isFalse(button.disabled, 'button should be enabled');
			assert.strictEqual(select.value, 'foo', 'foo should be selected');
			assert.strictEqual(select.children.length, 3, 'should have 3 children');
			assert.isFalse(onclickListener.called, 'onclickListener should not have been called');
			const clickEvent = document.createEvent('CustomEvent');
			clickEvent.initEvent('click', true, true);
			button.dispatchEvent(clickEvent);
			assert.isTrue(onclickListener.called, 'onclickListener should have been called');
			document.body.removeChild(iframe);
		});
		it('should replace text node on merge when value is different', () => {
			const iframe = document.createElement('iframe');
			document.body.appendChild(iframe);
			iframe.contentDocument!.write(`<div class="foo"><span>hello</span><span>world</span></div>`);
			iframe.contentDocument!.close();
			const div = iframe.contentDocument!.body.firstChild as HTMLElement;
			const firstSpan = div.childNodes[0];
			const firstText = firstSpan.childNodes[0] as Text;
			const secondSpan = div.childNodes[1] as HTMLLabelElement;
			const secondText = secondSpan.childNodes[0] as Text;
			class App extends WidgetBase {
				render() {
					return v('div', [v('span', ['hello']), v('span', ['tests'])]);
				}
			}
			const r = renderer(() => w(App, {}));
			r.mount({ domNode: iframe.contentDocument!.body });
			assert.strictEqual(div, iframe.contentDocument!.body.firstChild);
			assert.strictEqual(firstSpan, iframe.contentDocument!.body.firstChild!.childNodes[0]);
			assert.strictEqual(firstText, iframe.contentDocument!.body.firstChild!.childNodes[0].childNodes[0]);
			assert.strictEqual(secondSpan, iframe.contentDocument!.body.firstChild!.childNodes[1]);
			assert.notStrictEqual(secondText, iframe.contentDocument!.body.firstChild!.childNodes[1].childNodes[0]);
			assert.strictEqual(div.outerHTML, '<div class="foo"><span>hello</span><span>tests</span></div>');
			document.body.removeChild(iframe);
		});
	});

	describe('sync mode', () => {
		it('should run afterRenderCallbacks sync', () => {
			const [Widget, meta] = getWidget(v('div', { key: '1' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.isTrue(meta.nodeHandlerStub.add.calledWith(div.childNodes[0] as Element, '1'));
		});

		it('should run defferedRenderCallbacks sync', () => {
			let callCount = 0;
			const [Widget] = getWidget(
				v('div', () => {
					callCount++;
					return {};
				})
			);
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual(callCount, 2);
		});
	});

	describe('node callbacks', () => {
		it('element not added to node handler for nodes without a key', () => {
			const [Widget, meta] = getWidget(v('div'));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div });
			resolvers.resolve();
			meta.setRenderResult(v('div'));

			resolvers.resolve();
			assert.isTrue(meta.nodeHandlerStub.add.notCalled);
		});

		it('element added on create to node handler for nodes with a key', () => {
			const [Widget, meta] = getWidget(v('div', { key: '1' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.isTrue(meta.nodeHandlerStub.add.called);
			assert.isTrue(meta.nodeHandlerStub.add.calledWith(div.childNodes[0] as Element, '1'));
		});

		it('element added on update to node handler for nodes with a key of 0', () => {
			const [Widget, meta] = getWidget(v('div', { key: 0 }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.isTrue(meta.nodeHandlerStub.add.called);
			assert.isTrue(meta.nodeHandlerStub.add.calledWith(div.childNodes[0] as Element, '0'));
		});

		it('element removed when dom node removed', () => {
			const [Widget, meta] = getWidget(v('div', { key: '1' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.isTrue(meta.nodeHandlerStub.add.called);
			assert.isTrue(meta.nodeHandlerStub.add.calledWith(div.childNodes[0] as Element, '1'));
			meta.setRenderResult(null);
			assert.isTrue(meta.nodeHandlerStub.remove.called);
			assert.isTrue(meta.nodeHandlerStub.remove.calledWith('1'));
		});

		it('addRoot called on node handler for created widgets with a zero key', () => {
			const [Widget, meta] = getWidget(v('div', { key: 0 }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.isTrue(meta.nodeHandlerStub.addRoot.called);
		});

		it('addRoot called on node handler for updated widgets with key', () => {
			const [Widget, meta] = getWidget(v('div', { key: '1' }));
			const r = renderer(() => w(Widget, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.isTrue(meta.nodeHandlerStub.addRoot.called);
		});
	});

	describe('animations', () => {
		describe('enterAnimation', () => {
			it('Does not invoke transition when null passed as enterAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget] = getWidget(v('div', [v('span', { enterAnimation: null })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				assert.isTrue(transition.enter.notCalled);
			});
			it('Does not invoke transition when undefined passed as enterAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget] = getWidget(v('div', [v('span', { enterAnimation: undefined })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				assert.isTrue(transition.enter.notCalled);
			});
			it('Does not invoke transition when false passed as enterAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget] = getWidget(v('div', [v('span', { enterAnimation: false })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				assert.isTrue(transition.enter.notCalled);
			});
			it('Does not invoke transition when true passed as enterAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget] = getWidget(v('div', [v('span', { enterAnimation: true })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				assert.isTrue(transition.enter.notCalled);
			});
		});
		describe('exitAnimation', () => {
			it('Does not invoke transition when null passed as exitAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget, meta] = getWidget(v('div', [v('span', { exitAnimation: null })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				meta.setRenderResult(v('div', []));
				assert.isTrue(transition.exit.notCalled);
			});
			it('Does not invoke transition when undefined passed as exitAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget, meta] = getWidget(v('div', [v('span', { exitAnimation: undefined })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				meta.setRenderResult(v('div', []));
				assert.isTrue(transition.exit.notCalled);
			});
			it('Does not invoke transition when false passed as exitAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget, meta] = getWidget(v('div', [v('span', { exitAnimation: false })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				meta.setRenderResult(v('div', []));
				assert.isTrue(transition.exit.notCalled);
			});
			it('Does not invoke transition when true passed as exitAnimation', () => {
				const transition = {
					enter: stub(),
					exit: stub()
				};
				const [Widget, meta] = getWidget(v('div', [v('span', { exitAnimation: true })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition });
				meta.setRenderResult(v('div', []));
				assert.isTrue(transition.exit.notCalled);
			});
		});
		describe('transitionStrategy', () => {
			it('will be invoked when enterAnimation is provided as a string', () => {
				const transitionStrategy = { enter: stub(), exit: stub() };
				const [Widget, meta] = getWidget(v('div'));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition: transitionStrategy });
				meta.setRenderResult(v('div', [v('span', { enterAnimation: 'fadeIn' })]));
				assert.isTrue(
					transitionStrategy.enter.calledWithExactly(
						(div.childNodes[0] as Element).firstChild,
						'fadeIn',
						undefined
					)
				);
			});
			it('will be invoked when exitAnimation is provided as a string', () => {
				const transitionStrategy = { enter: stub(), exit: stub() };
				const [Widget, meta] = getWidget(v('div', [v('span', { exitAnimation: 'fadeOut' })]));
				const r = renderer(() => w(Widget, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition: transitionStrategy });
				meta.setRenderResult(v('div', []));
				assert.isTrue(
					transitionStrategy.exit.calledWithExactly(
						(div.childNodes[0] as Element).firstChild,
						'fadeOut',
						undefined
					)
				);
			});
			it('Should run enter animations when a widget is added', () => {
				const transitionStrategy = { enter: stub(), exit: stub() };
				class Child extends WidgetBase {
					render() {
						return v('div', { enterAnimation: 'enter' });
					}
				}
				let addItem: any;
				class Parent extends WidgetBase {
					items = [w(Child, { key: '1' })];
					constructor() {
						super();
						addItem = this.addItem;
					}

					addItem = () => {
						this.items = [...this.items, w(Child, { key: '2' })];
						this.invalidate();
					};
					render() {
						return v('div', [...this.items]);
					}
				}
				const r = renderer(() => w(Parent, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition: transitionStrategy });
				assert.isTrue(
					transitionStrategy.enter.calledWithExactly(
						(div.childNodes[0] as Element).children[0],
						'enter',
						undefined
					)
				);
				addItem();
				assert.isTrue(
					transitionStrategy.enter.calledWithExactly(
						(div.childNodes[0] as Element).children[1],
						'enter',
						undefined
					)
				);
			});
			it('Should run exit animations when a widget is removed', () => {
				const transitionStrategy = { enter: stub(), exit: stub() };
				class Child extends WidgetBase {
					render() {
						return v('div', { exitAnimation: 'exit' });
					}
				}
				let removeItem: any;
				class Parent extends WidgetBase {
					items = [w(Child, { key: '1' }), w(Child, { key: '2' })];
					constructor() {
						super();
						removeItem = this.removeItem;
					}

					removeItem = () => {
						this.items = [this.items[0]];
						this.invalidate();
					};
					render() {
						return v('div', [...this.items]);
					}
				}
				const r = renderer(() => w(Parent, {}));
				const div = document.createElement('div');
				r.mount({ domNode: div, sync: true, transition: transitionStrategy });
				const node = (div.childNodes[0] as Element).children[1];
				removeItem();
				assert.isTrue(transitionStrategy.exit.calledWithExactly(node, 'exit', undefined));
			});
		});
	});

	describe('render hooks', () => {
		beforeEach(() => {
			global.dojo_scope = {};
		});

		it('set rendering', () => {
			assert.strictEqual(global.dojo_scope.rendering, undefined);
			setRendering(true);
			assert.strictEqual(global.dojo_scope.rendering, true);
			setRendering(false);
			assert.strictEqual(global.dojo_scope.rendering, false);
		});

		it('block count', () => {
			assert.strictEqual(global.dojo_scope.blocksPending, undefined);
			incrementBlockCount();
			assert.strictEqual(global.dojo_scope.blocksPending, 1);
			incrementBlockCount();
			assert.strictEqual(global.dojo_scope.blocksPending, 2);
			decrementBlockCount();
			assert.strictEqual(global.dojo_scope.blocksPending, 1);
			decrementBlockCount();
			assert.strictEqual(global.dojo_scope.blocksPending, 0);
		});

		it('should not set rendering to false if a render has been scheduled', () => {
			const factory = create({ icache }).properties<any>();
			let key = 0;
			const Foo = factory(function App({ properties }) {
				properties().doSomething();
				return <div />;
			});
			const App = factory(function App({ middleware: { icache } }) {
				return (
					<Foo
						key={key}
						doSomething={() => {
							icache.set('key', key);
						}}
					/>
				);
			});
			const domNode = document.createElement('div');
			const r = renderer(() => <App />);
			r.mount({ domNode });
			assert.strictEqual(global.dojo_scope.rendering, true);
			key++;
			resolvers.resolve();
			assert.strictEqual(global.dojo_scope.rendering, true);
			key++;
			resolvers.resolve();
			assert.strictEqual(global.dojo_scope.rendering, true);
			resolvers.resolve();
			assert.strictEqual(global.dojo_scope.rendering, false);
		});
	});

	describe('focus', () => {
		it('focus is only called once when set to true', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					focus: true
				})
			);

			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const focusSpy = spy(input, 'focus');
			resolvers.resolveRAF();
			assert.isTrue(focusSpy.calledOnce);
			resolvers.resolveRIC();
			assert.isTrue(focusSpy.calledOnce);
			meta.setRenderResult(v('input', { focus: true }));
			resolvers.resolveRAF();
			assert.isTrue(focusSpy.calledOnce);
			resolvers.resolveRIC();
			assert.isTrue(focusSpy.calledOnce);
			document.body.removeChild(input);
		});

		it('focus is called when focus property is set to true from false', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					focus: false
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const focusSpy = spy(input, 'focus');
			resolvers.resolve();
			assert.isTrue(focusSpy.notCalled);
			meta.setRenderResult(v('input', { focus: true }));
			resolvers.resolve();
			assert.isTrue(focusSpy.notCalled);
			resolvers.resolve();
			assert.isTrue(focusSpy.calledOnce);
			document.body.removeChild(input);
		});

		it('Should focus if function for focus returns true', () => {
			const shouldFocus = () => {
				return true;
			};
			const [Widget, meta] = getWidget(
				v('input', {
					focus: shouldFocus
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const focusSpy = spy(input, 'focus');
			resolvers.resolve();
			assert.isTrue(focusSpy.calledOnce);
			meta.setRenderResult(v('input', { focus: shouldFocus }));
			resolvers.resolve();
			assert.isTrue(focusSpy.calledOnce);
			resolvers.resolve();
			assert.isTrue(focusSpy.calledTwice);
			document.body.removeChild(input);
		});

		it('Should never focus if function for focus returns false', () => {
			const shouldFocus = () => false;
			const [Widget, meta] = getWidget(
				v('input', {
					focus: shouldFocus
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const focusSpy = spy(input, 'focus');
			resolvers.resolve();
			assert.isTrue(focusSpy.notCalled);
			meta.setRenderResult(v('input', { focus: shouldFocus }));
			resolvers.resolve();
			assert.isTrue(focusSpy.notCalled);
			document.body.removeChild(input);
		});
	});

	describe('blur', () => {
		it('blur is only called once when set to true', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					blur: true
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const blurSpy = spy(input, 'blur');
			resolvers.resolve();
			assert.isTrue(blurSpy.calledOnce);
			meta.setRenderResult(v('input', { blur: true }));
			assert.isTrue(blurSpy.calledOnce);
			document.body.removeChild(input);
		});

		it('blur is called when blur property is set to true from false', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					blur: false
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const blurSpy = spy(input, 'blur');
			resolvers.resolve();
			assert.isTrue(blurSpy.notCalled);
			meta.setRenderResult(v('input', { blur: true }));
			resolvers.resolve();
			assert.isTrue(blurSpy.notCalled);
			resolvers.resolve();
			assert.isTrue(blurSpy.calledOnce);
			document.body.removeChild(input);
		});

		it('Should blur if function for blur returns true', () => {
			const shouldBlur = () => {
				return true;
			};
			const [Widget, meta] = getWidget(
				v('input', {
					blur: shouldBlur
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const blurSpy = spy(input, 'blur');
			resolvers.resolve();
			assert.isTrue(blurSpy.calledOnce);
			meta.setRenderResult(v('input', { blur: shouldBlur }));
			resolvers.resolve();
			assert.isTrue(blurSpy.calledOnce);
			resolvers.resolve();
			assert.isTrue(blurSpy.calledTwice);
			document.body.removeChild(input);
		});

		it('Should never blur if function for blur returns false', () => {
			const shouldBlur = () => false;
			const [Widget, meta] = getWidget(
				v('input', {
					blur: shouldBlur
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const blurSpy = spy(input, 'blur');
			resolvers.resolve();
			assert.isTrue(blurSpy.notCalled);
			meta.setRenderResult(v('input', { blur: shouldBlur }));
			resolvers.resolve();
			assert.isTrue(blurSpy.notCalled);
			document.body.removeChild(input);
		});
	});

	describe('scrollIntoView', () => {
		it('scrollIntoView is only called once when set to true', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					scrollIntoView: true
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const scrollIntoViewStub = stub();
			input.scrollIntoView = scrollIntoViewStub;
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.calledOnce);
			meta.setRenderResult(v('input', { scrollIntoView: true }));
			assert.isTrue(scrollIntoViewStub.calledOnce);
			document.body.removeChild(input);
		});

		it('scrollIntoView is called when scrollIntoView property is set to true from false', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					scrollIntoView: false
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const scrollIntoViewStub = stub();
			input.scrollIntoView = scrollIntoViewStub;
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.notCalled);
			meta.setRenderResult(v('input', { scrollIntoView: true }));
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.notCalled);
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.calledOnce);
			document.body.removeChild(input);
		});

		it('Should scrollIntoView if function for scrollIntoView returns true', () => {
			const shouldScroll = () => {
				return true;
			};
			const [Widget, meta] = getWidget(
				v('input', {
					scrollIntoView: shouldScroll
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const scrollIntoViewStub = stub();
			input.scrollIntoView = scrollIntoViewStub;
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.calledOnce);
			meta.setRenderResult(v('input', { scrollIntoView: shouldScroll }));
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.calledOnce);
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.calledTwice);
			document.body.removeChild(input);
		});

		it('Should never scrollIntoView if function for scrollIntoView returns false', () => {
			const shouldScroll = () => false;
			const [Widget, meta] = getWidget(
				v('input', {
					scrollIntoView: shouldScroll
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const scrollIntoViewStub = stub();
			input.scrollIntoView = scrollIntoViewStub;
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.notCalled);
			meta.setRenderResult(v('input', { scrollIntoView: shouldScroll }));
			resolvers.resolve();
			assert.isTrue(scrollIntoViewStub.notCalled);
			document.body.removeChild(input);
		});
	});

	describe('click', () => {
		it('click is only called once when set to true', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					click: true
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const clickSpy = spy(input, 'click');
			resolvers.resolve();
			assert.isTrue(clickSpy.calledOnce);
			meta.setRenderResult(v('input', { click: true }));
			assert.isTrue(clickSpy.calledOnce);
			document.body.removeChild(input);
		});

		it('click is called when click property is set to true from false', () => {
			const [Widget, meta] = getWidget(
				v('input', {
					click: false
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const clickSpy = spy(input, 'click');
			resolvers.resolve();
			assert.isTrue(clickSpy.notCalled);
			meta.setRenderResult(v('input', { click: true }));
			resolvers.resolve();
			assert.isTrue(clickSpy.notCalled);
			resolvers.resolve();
			assert.isTrue(clickSpy.calledOnce);
			document.body.removeChild(input);
		});

		it('Should click if function for click returns true', () => {
			const shouldClick = () => {
				return true;
			};
			const [Widget, meta] = getWidget(
				v('input', {
					click: shouldClick
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const clickSpy = spy(input, 'click');
			resolvers.resolve();
			assert.isTrue(clickSpy.calledOnce);
			meta.setRenderResult(v('input', { click: shouldClick }));
			resolvers.resolve();
			assert.isTrue(clickSpy.calledOnce);
			resolvers.resolve();
			assert.isTrue(clickSpy.calledTwice);
			document.body.removeChild(input);
		});

		it('Should never click if function for click returns false', () => {
			const shouldClick = () => false;
			const [Widget, meta] = getWidget(
				v('input', {
					click: shouldClick
				})
			);
			const r = renderer(() => w(Widget, {}));
			r.mount();
			const input = document.body.lastChild as HTMLElement;
			const clickSpy = spy(input, 'click');
			resolvers.resolve();
			assert.isTrue(clickSpy.notCalled);
			meta.setRenderResult(v('input', { click: shouldClick }));
			resolvers.resolve();
			assert.isTrue(clickSpy.notCalled);
			document.body.removeChild(input);
		});
	});

	describe('selects', () => {
		it('should set initial select value', () => {
			const r = renderer(() =>
				v('select', { value: 'a' }, [
					v('option'),
					v('option', { value: 'a' }, ['a']),
					v('option', { value: 'b' }, ['b'])
				])
			);

			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.children[0] as any).value, 'a');
		});

		it('should support changing the select value', () => {
			let change: any;
			class Select extends WidgetBase {
				constructor() {
					super();
					change = this.change.bind(this);
				}

				value = '';
				change(event: any) {
					this.value = event.target.value;
					this.invalidate();
				}
				render() {
					return v('select', { onchange: this.change, value: this.value }, [
						v('option', { value: '' }),
						v('option', { value: 'a' }, ['a']),
						v('option', { value: 'b' }, ['b'])
					]);
				}
			}

			const r = renderer(() => w(Select, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.children[0] as any).value, '');
			// set the value as this is what happens when the select is click in the browser
			(div.children[0] as any).value = 'a';
			change({ target: { value: 'a' } });
			assert.strictEqual((div.children[0] as any).value, 'a');
			// set the value as this is what happens when the select is click in the browser
			(div.children[0] as any).value = 'b';
			change({ target: { value: 'b' } });
			assert.strictEqual((div.children[0] as any).value, 'b');
		});

		it('should support changing the select value - programmatically', () => {
			let change: any;
			class Select extends WidgetBase {
				constructor() {
					super();
					change = this.change.bind(this);
				}

				value = '';
				change(event: any) {
					this.value = event.target.value;
					this.invalidate();
				}
				render() {
					return v('select', { onchange: this.change, value: this.value }, [
						v('option', { value: '' }),
						v('option', { value: 'a' }, ['a']),
						v('option', { value: 'b' }, ['b'])
					]);
				}
			}

			const r = renderer(() => w(Select, {}));
			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.children[0] as any).value, '');
			change({ target: { value: 'a' } });
			assert.strictEqual((div.children[0] as any).value, 'a');
			change({ target: { value: 'b' } });
			assert.strictEqual((div.children[0] as any).value, 'b');
		});

		it('should support multi-select selects', () => {
			const r = renderer(() =>
				v('select', { key: 'multi', multiple: true }, [
					v('option', { key: 'a', value: 'a', selected: true }, ['a']),
					v('option', { key: 'b', value: 'b', selected: true }, ['b']),
					v('option', { key: 'c', value: 'c' }, ['c'])
				])
			);

			const div = document.createElement('div');
			r.mount({ domNode: div, sync: true });
			assert.strictEqual((div.childNodes[0].childNodes[0] as any).selected, true);
			assert.strictEqual((div.childNodes[0].childNodes[1] as any).selected, true);
			assert.strictEqual((div.childNodes[0].childNodes[2] as any).selected, false);
		});
	});

	it('i18n Mixin', () => {
		let changeRtl: any;
		class MyWidget extends I18nMixin(WidgetBase) {
			render() {
				return v('span');
			}
		}

		class App extends WidgetBase {
			private _rtl: boolean | undefined = undefined;
			constructor() {
				super();
				changeRtl = (rtl?: boolean) => {
					this._rtl = rtl;
					this.invalidate();
				};
			}
			render() {
				return w(MyWidget, { rtl: this._rtl });
			}
		}
		const r = renderer(() => w(App, {}));
		const div = document.createElement('div');
		r.mount({ domNode: div, sync: true });
		const root = div.childNodes[0] as HTMLElement;
		assert.strictEqual(root.dir, '');
		changeRtl(true);
		assert.strictEqual(root.dir, 'rtl');
		changeRtl(false);
		assert.strictEqual(root.dir, 'ltr');
	});

	it('widget methods are bound correctly', () => {
		const stubby = stub();
		class Bar extends WidgetBase<any> {
			render() {
				this.properties.func();
				return 'blah';
			}
		}
		class Foo extends WidgetBase {
			private _stub = stubby;

			protected test() {
				this._stub();
			}
		}

		class FooSubClass extends Foo {
			render() {
				return w(Bar, { func: this.test });
			}
		}

		const r = renderer(() => w(FooSubClass, {}));
		const root: any = document.createElement('div');
		r.mount({ domNode: root });
		assert.isTrue(stubby.calledOnce);
	});

	it('infer mixin typings correctly', () => {
		class MyWidget extends ThemedMixin(I18nMixin(WidgetBase)) {
			render() {
				return <div>hello dojo</div>;
			}
		}
		const root: any = document.createElement('div');
		const r = renderer(() => <MyWidget theme={{}} classes={{}} locale="en" rtl={true} />);
		r.mount({ domNode: root });

		assert.strictEqual(root.children[0].getAttribute('lang'), 'en');
		assert.strictEqual(root.children[0].getAttribute('dir'), 'rtl');
		assert.strictEqual(root.children[0].innerHTML, 'hello dojo');
	});
});
