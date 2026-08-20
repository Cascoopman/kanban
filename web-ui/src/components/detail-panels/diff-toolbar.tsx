import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { RuntimeWorkspaceChangesMode } from "@/runtime/types";

const DIFF_MODE_ACTIVE_BACKGROUND = "color-mix(in srgb, var(--color-surface-3) 80%, var(--color-text-primary))";

function getDiffModeLabel(mode: RuntimeWorkspaceChangesMode): string {
	return mode === "last_turn" ? "Last Turn" : "All Changes";
}

function DiffModeButton({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}): React.ReactElement {
	return (
		<Button
			variant="ghost"
			size="sm"
			onClick={onClick}
			aria-pressed={active}
			className="h-5 rounded-sm text-xs"
			style={
				active
					? {
							backgroundColor: DIFF_MODE_ACTIVE_BACKGROUND,
							color: "var(--color-text-primary)",
						}
					: undefined
			}
		>
			{children}
		</Button>
	);
}

export function DiffToolbar({
	mode,
	onModeChange,
	isExpanded,
	onToggleExpand,
	onCollapse,
	hideExpand,
}: {
	mode: RuntimeWorkspaceChangesMode;
	onModeChange: (mode: RuntimeWorkspaceChangesMode) => void;
	isExpanded: boolean;
	onToggleExpand: () => void;
	onCollapse?: () => void;
	hideExpand?: boolean;
}): React.ReactElement {
	return (
		<div className="flex items-center gap-1 border-b border-divider px-2 py-1">
			{isExpanded ? (
				<Button
					variant="ghost"
					size="sm"
					icon={<X size={14} />}
					onClick={onToggleExpand}
					className="h-5"
					aria-label="Exit expanded diff view"
				/>
			) : null}
			<div className="inline-flex items-center gap-0.5 rounded-md p-0.5">
				<DiffModeButton active={mode === "working_copy"} onClick={() => onModeChange("working_copy")}>
					All Changes
				</DiffModeButton>
				<DiffModeButton active={mode === "last_turn"} onClick={() => onModeChange("last_turn")}>
					Last Turn
				</DiffModeButton>
			</div>
			<div className="ml-auto flex items-center gap-1">
				{onCollapse ? (
					<Button
						variant="ghost"
						size="sm"
						icon={<PanelRightClose size={14} />}
						onClick={onCollapse}
						className="h-5"
						aria-label="Collapse diff viewer"
					/>
				) : null}
				{!hideExpand ? (
					<Button
						variant="ghost"
						size="sm"
						icon={isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
						onClick={onToggleExpand}
						className="h-5"
						aria-label={isExpanded ? "Exit expanded diff view" : "Expand split diff view"}
					/>
				) : null}
			</div>
		</div>
	);
}

export function CollapsedDiffToolbar({
	mode,
	onExpand,
}: {
	mode: RuntimeWorkspaceChangesMode;
	onExpand: () => void;
}): React.ReactElement {
	const label = getDiffModeLabel(mode);
	return (
		<Button
			variant="ghost"
			size="sm"
			icon={<PanelRightOpen size={14} />}
			onClick={onExpand}
			className="h-full w-8 shrink-0 flex-col justify-start gap-2 rounded-none border-l border-divider px-0 py-1.5"
			aria-label={`Expand diff viewer (${label})`}
		>
			<span aria-hidden="true" className="rotate-180 text-[11px] font-medium [writing-mode:vertical-rl]">
				{label}
			</span>
		</Button>
	);
}
