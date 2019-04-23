import { Destroyable } from '../../core/Destroyable';
import Map from '../../shim/Map';
import { UseOptions, UseBase, SupportedClassName } from '../interfaces';

export interface ClassNames {
	[key: string]: string;
}

export interface ThemeOptions {
	css: ClassNames;
}

export interface Classes {
	[widgetKey: string]: {
		[classKey: string]: SupportedClassName[];
	};
}

const THEME_KEY = ' _key';

export class Theme extends Destroyable implements UseBase {
	private _cssMap = new Map();
	private _theme: any;
	private _invalidator: any;
	private _properties: any;

	constructor(options: UseOptions) {
		super();
		this._properties = options.properties;
		this._invalidator = options.invalidate;
		const injectorItem = options.registry.getInjector('__theme_injector');
		if (injectorItem) {
			const { injector, invalidator } = injectorItem;
			this.own(
				invalidator.on('invalidate', () => {
					this._cssMap.clear();
					this._invalidator();
				})
			);
			if (!this._theme) {
				this._theme = injector();
			}
		}
	}

	public __setProperties__(props: any) {
		this._properties = props;
	}

	public get<T extends ClassNames>(css: T): T {
		let theme = this._cssMap.get(css);
		if (theme) {
			return theme;
		}

		const { [THEME_KEY]: key, ...classes } = css as any;
		theme = classes;
		if (this._theme && this._theme[key]) {
			theme = { ...theme, ...this._theme[key] };
		}

		if (this._properties.classes && this._properties.classes[key]) {
			const classKeys = Object.keys(this._properties.classes[key]);
			for (let i = 0; i < classKeys.length; i++) {
				const classKey = classKeys[i];
				if (theme[classKey]) {
					theme[classKey] = `${theme[classKey]} ${this._properties.classes[key][classKey].join(' ')}`;
				}
			}
		}
		this._cssMap.set(css, theme);
		return theme;
	}
}

export default Theme;
