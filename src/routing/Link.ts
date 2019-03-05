import { WidgetBase } from '../widget-core/WidgetBase';
import { v, w } from '../widget-core/d';
import { WNode } from '../widget-core/interfaces';
import { LinkProperties } from './interfaces';
import { Router } from './Router';
import VirtualLink from './VirtualLink';

export class Link extends WidgetBase<LinkProperties> {
	private _getProperties(gotoRoute: Function) {
		let { routerKey = 'router', to, isOutlet = true, target, params = {}, onClick, ...props } = this.properties;
		const item = this.registry.getInjector<Router>(routerKey);
		let href: string | undefined = to;

		if (item) {
			const router = item.injector();
			if (isOutlet) {
				href = router.link(href, params);
			}
			const onclick = (event: MouseEvent) => {
				onClick && onClick(event);

				if (!event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !target) {
					event.preventDefault();
					href !== undefined && gotoRoute(href);
				}
			};
			return { ...props, onclick, href };
		}
		return { ...props, href };
	}

	protected render(): WNode {
		const { to, routerKey = 'router', params } = this.properties;

		return w(VirtualLink, {
			renderer: ({ active, gotoRoute }: { gotoRoute: Function; active: boolean }) => {
				let { activeClasses, classes = [], ...props } = this.properties;
				classes = Array.isArray(classes) ? classes : [classes];
				if (active) {
					classes = [...classes, ...activeClasses];
				}
				props = { ...props, classes };
				return v('a', this._getProperties(gotoRoute), this.children);
			},
			to,
			routerKey,
			params
		});
	}
}

export default Link;
