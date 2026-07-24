import type { Dispatch, SetStateAction } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useBooleanLocalStorageValue, useRawLocalStorageValue } from "@/utils/react-use";

describe("local storage hook wrappers", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		window.localStorage.clear();
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("composes raw functional updates against the latest value", async () => {
		let setValue: Dispatch<SetStateAction<string>> | null = null;
		function Harness(): React.ReactElement {
			const [value, updateValue] = useRawLocalStorageValue("test.raw-value", "", (storedValue) => storedValue);
			setValue = updateValue;
			return <span>{value}</span>;
		}

		await act(async () => {
			root.render(<Harness />);
		});
		await act(async () => {
			setValue?.((currentValue) => `${currentValue}review`);
			setValue?.((currentValue) => `${currentValue},trash`);
		});

		expect(container.textContent).toBe("review,trash");
		expect(window.localStorage.getItem("test.raw-value")).toBe("review,trash");
	});

	it("composes boolean functional updates against the latest value", async () => {
		let setValue: Dispatch<SetStateAction<boolean>> | null = null;
		function Harness(): React.ReactElement {
			const [value, updateValue] = useBooleanLocalStorageValue("test.boolean-value", false);
			setValue = updateValue;
			return <span>{String(value)}</span>;
		}

		await act(async () => {
			root.render(<Harness />);
		});
		await act(async () => {
			setValue?.((currentValue) => !currentValue);
			setValue?.((currentValue) => !currentValue);
		});

		expect(container.textContent).toBe("false");
		expect(window.localStorage.getItem("test.boolean-value")).toBe("false");
	});
});
