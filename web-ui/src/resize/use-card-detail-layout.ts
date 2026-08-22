import { useCallback, useState } from "react";

import { useLayoutResetEffect } from "@/resize/layout-customizations";
import { clampBetween } from "@/resize/resize-persistence";
import {
	getResizePreferenceDefaultValue,
	loadResizePreference,
	persistResizePreference,
	type ResizeNumberPreference,
} from "@/resize/resize-preferences";
import { LocalStorageKey } from "@/storage/local-storage-store";

const TASK_CARDS_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.DetailTaskCardsPanelRatio,
	defaultValue: 0.2,
	normalize: (value) => clampBetween(value, 0.14, 0.4),
};

const AGENT_RATIO_PREFERENCE: ResizeNumberPreference = {
	key: LocalStorageKey.DetailAgentPanelRatio,
	defaultValue: 0.4,
	normalize: (value) => clampBetween(value, 0.15, 0.75),
};

export function useCardDetailLayout(): {
	agentPanelRatio: number;
	setAgentPanelRatio: (ratio: number) => void;
	setTaskCardsPanelRatio: (ratio: number) => void;
	taskCardsPanelRatio: number;
} {
	const [taskCardsPanelRatio, setTaskCardsPanelRatioState] = useState(() =>
		loadResizePreference(TASK_CARDS_RATIO_PREFERENCE),
	);
	const [agentPanelRatio, setAgentPanelRatioState] = useState(() => loadResizePreference(AGENT_RATIO_PREFERENCE));
	const setTaskCardsPanelRatio = useCallback((ratio: number) => {
		setTaskCardsPanelRatioState(persistResizePreference(TASK_CARDS_RATIO_PREFERENCE, ratio));
	}, []);

	const setAgentPanelRatio = useCallback((ratio: number) => {
		setAgentPanelRatioState(persistResizePreference(AGENT_RATIO_PREFERENCE, ratio));
	}, []);

	useLayoutResetEffect(() => {
		setTaskCardsPanelRatioState(getResizePreferenceDefaultValue(TASK_CARDS_RATIO_PREFERENCE));
		setAgentPanelRatioState(getResizePreferenceDefaultValue(AGENT_RATIO_PREFERENCE));
	});

	return {
		taskCardsPanelRatio,
		setTaskCardsPanelRatio,
		agentPanelRatio,
		setAgentPanelRatio,
	};
}
