import type { DependencyList, Dispatch, MutableRefObject, SetStateAction } from "react";
import { useCallback, useRef } from "react";
import {
	useDebounce as useReactUseDebounce,
	useEvent as useReactUseEvent,
	useInterval as useReactUseInterval,
	useLocalStorage as useReactUseLocalStorage,
	useMeasure as useReactUseMeasure,
	useMedia as useReactUseMedia,
	useTitle as useReactUseTitle,
	useUnmount as useReactUseUnmount,
} from "react-use";

type DomEventOptions = boolean | AddEventListenerOptions;
type StateSetter<T> = Dispatch<SetStateAction<T>>;

function getWindowTarget(): Window | null {
	if (typeof window === "undefined") {
		return null;
	}
	return window;
}

function getDocumentTarget(): Document | null {
	if (typeof document === "undefined") {
		return null;
	}
	return document;
}

export function useWindowEvent<K extends keyof WindowEventMap>(
	name: K,
	handler: ((event: WindowEventMap[K]) => void) | null,
	options?: DomEventOptions,
): void {
	useReactUseEvent(name, handler as ((event?: Event) => void) | null, getWindowTarget(), options);
}

export function useDocumentEvent<K extends keyof DocumentEventMap>(
	name: K,
	handler: ((event: DocumentEventMap[K]) => void) | null,
	options?: DomEventOptions,
): void {
	useReactUseEvent(name, handler as ((event?: Event) => void) | null, getDocumentTarget(), options);
}

export function useInterval(callback: () => void, delayMs: number | null): void {
	useReactUseInterval(callback, delayMs);
}

export function useDebouncedEffect(effect: () => void, delayMs: number, deps: DependencyList): void {
	useReactUseDebounce(effect, delayMs, deps);
}

function resolveNextValue<T>(nextValue: SetStateAction<T>, currentValue: T): T {
	if (typeof nextValue === "function") {
		return (nextValue as (previousValue: T) => T)(currentValue);
	}
	return nextValue;
}

function useLatestValueRef<T>(value: T): MutableRefObject<T> {
	const valueRef = useRef(value);
	valueRef.current = value;
	return valueRef;
}

export function useBooleanLocalStorageValue(key: string, initialValue: boolean): [boolean, StateSetter<boolean>] {
	const [storedValue, setStoredValue] = useReactUseLocalStorage<boolean>(key, initialValue, {
		raw: false,
		serializer: (value) => String(value),
		deserializer: (value) => value === "true",
	});
	const value = storedValue ?? initialValue;
	const valueRef = useLatestValueRef(value);
	const setValue: StateSetter<boolean> = useCallback(
		(nextValue) => {
			const resolvedValue = resolveNextValue(nextValue, valueRef.current);
			valueRef.current = resolvedValue;
			setStoredValue(resolvedValue);
		},
		[setStoredValue, valueRef],
	);
	return [value, setValue];
}

export function useRawLocalStorageValue<T extends string>(
	key: string,
	initialValue: T,
	normalize: (value: string) => T | null,
): [T, StateSetter<T>] {
	const [storedValue, setStoredValue] = useReactUseLocalStorage<string>(key, initialValue, {
		raw: true,
	});
	const value = storedValue ? (normalize(storedValue) ?? initialValue) : initialValue;
	const valueRef = useLatestValueRef(value);
	const setValue: StateSetter<T> = useCallback(
		(nextValue) => {
			const resolvedValue = resolveNextValue(nextValue, valueRef.current);
			valueRef.current = resolvedValue;
			setStoredValue(resolvedValue);
		},
		[setStoredValue, valueRef],
	);
	return [value, setValue];
}

export function useLocalStorageValue<T>(key: string, initialValue: T): [T, StateSetter<T>, () => void] {
	const [storedValue, setStoredValue, removeStoredValue] = useReactUseLocalStorage<T>(key, initialValue);
	const value = storedValue ?? initialValue;
	const valueRef = useLatestValueRef(value);
	const setValue: StateSetter<T> = useCallback(
		(nextValue) => {
			const resolvedValue = resolveNextValue(nextValue, valueRef.current);
			valueRef.current = resolvedValue;
			setStoredValue(resolvedValue);
		},
		[setStoredValue, valueRef],
	);
	const removeValue = useCallback(() => {
		valueRef.current = initialValue;
		removeStoredValue();
	}, [initialValue, removeStoredValue, valueRef]);
	return [value, setValue, removeValue];
}

export function useDocumentTitle(title: string): void {
	useReactUseTitle(title);
}

export function useMeasure<T extends Element = Element>() {
	return useReactUseMeasure<T>();
}

export function useUnmount(fn: () => void): void {
	useReactUseUnmount(fn);
}

export function useMedia(query: string, defaultState?: boolean): boolean {
	return useReactUseMedia(query, defaultState);
}
