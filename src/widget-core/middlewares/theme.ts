import { middleware } from '../tsx';
import { SupportedClassName } from '../interfaces';
import injector from './injector';

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

export interface ThemeProperties {
	theme?: any;
	classes?: any;
}

const THEME_KEY = ' _key';

const createFactory = middleware<ThemeProperties>();

export const theme = createFactory({ injector }, ({ middleware, properties }) => {
	let cssMap = new Map();
	let injectedTheme = middleware.injector.get('__theme_injector');

	function getTheme() {
		if (properties.theme) {
			return properties.theme;
		}
		if (injectedTheme) {
			return injectedTheme.get();
		}
	}
	return {
		get<T extends ClassNames>(css: T): T {
			let cached = cssMap.get(css);
			if (cached) {
				return cached;
			}

			const { [THEME_KEY]: key, ...classes } = css as any;
			theme = classes;
			if (properties.theme && properties.theme[key]) {
				theme = { ...theme, ...properties.theme[key] };
			}

			if (properties.classes && properties.classes[key]) {
				const classKeys = Object.keys(properties.classes[key]);
				for (let i = 0; i < classKeys.length; i++) {
					const classKey = classKeys[i];
					if (theme[classKey]) {
						theme[classKey] = `${theme[classKey]} ${properties.classes[key][classKey].join(' ')}`;
					}
				}
			}
			cssMap.set(css, theme);
			return theme;
		}
	};
});

export default theme;
