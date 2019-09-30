const { registerSuite } = intern.getInterface('object');
const { assert } = intern.getPlugin('chai');
import { WidgetBase } from '../../../src/core/WidgetBase';
import { Registry } from '../../../src/core/Registry';
import { WNode, RenderResult } from '../../../src/core/interfaces';
import { create, tsx, fromRegistry } from '../../../src/core/vdom';

const registry = new Registry();

registerSuite('tsx integration', {
	'can use tsx'() {
		interface FooProperties {
			hello: string;
		}
		class Foo extends WidgetBase<FooProperties> {
			render() {
				const { hello } = this.properties;
				return (
					<header classes={['background']}>
						<div>{hello}</div>
					</header>
				);
			}
		}
		class Bar extends WidgetBase<any> {
			render() {
				return <Foo hello="world" />;
			}
		}

		class Qux extends WidgetBase<any> {
			render() {
				const LazyFoo = fromRegistry<FooProperties>('LazyFoo');
				return <LazyFoo hello="cool" />;
			}
		}

		const bar = new Bar();
		bar.registry.base = registry;
		const barRender = bar.__render__() as WNode;
		assert.deepEqual(barRender.properties, { hello: 'world' } as any);
		assert.strictEqual(barRender.widgetConstructor, Foo);
		assert.lengthOf(barRender.children, 0);

		const qux = new Qux();
		qux.registry.base = registry;
		const firstQuxRender = qux.__render__() as WNode;
		assert.strictEqual(firstQuxRender.widgetConstructor, 'LazyFoo');
	},
	'typed children'() {
		const factory = create().children<{ left: () => RenderResult; right: () => RenderResult }>();
		const Foo = factory(function Foo({ children }) {
			const [c] = children();
			return (
				<div>
					<div>{c.left()}</div>
					<div>{c.right()}</div>
				</div>
			);
		});
		const Other = create()(function Other() {
			return '';
		});

		<Other>
			<div />
		</Other>;

		// types correctly
		<Foo>{{ left: () => 'left', right: () => 'right' }}</Foo>;
		// uncomment to see compile errors
		// <Foo>{{ left: () => 'left'}}</Foo>;
		// <Foo>{{ right: () => 'right'}}</Foo>;
		// <Foo><div></div></Foo>;
	}
});
