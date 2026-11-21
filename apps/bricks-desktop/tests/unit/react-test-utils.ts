import { act, createElement, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export function renderHtml<P extends object>(Component: ComponentType<P>, props?: NoInfer<P>): string {
	return renderToStaticMarkup(createElement(Component, (props ?? {}) as P));
}

export interface MountedComponent<P extends object> {
	rerender: (nextProps: Partial<P>) => void;
	unmount: () => void;
}

export function mountReact<P extends object>(
	Component: ComponentType<P>,
	options: { target: HTMLElement; props?: NoInfer<P> }
): MountedComponent<P> {
	let currentProps = (options.props ?? {}) as P;
	let root: Root | null = null;
	act(() => {
		root = createRoot(options.target);
		root.render(createElement(Component, currentProps));
	});
	return {
		rerender(nextProps: Partial<P>) {
			currentProps = { ...currentProps, ...nextProps };
			act(() => {
				root?.render(createElement(Component, currentProps));
			});
		},
		unmount() {
			act(() => {
				root?.unmount();
			});
			root = null;
		}
	};
}

export function flushReact(fn?: () => void): void {
	act(() => {
		fn?.();
	});
}

export async function tickReact(): Promise<void> {
	await act(async () => {
		await Promise.resolve();
	});
}
