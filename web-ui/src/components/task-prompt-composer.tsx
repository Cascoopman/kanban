import type { KeyboardEvent, ReactElement } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type InlineCompletionItem, InlineCompletionPicker } from "@/components/inline-completion-picker";
import {
	applyTaskPromptCompletion,
	buildMentionInsertText,
	detectActiveTaskPromptMention,
} from "@/components/task-prompt-composer-completion";
import { cn } from "@/components/ui/cn";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { useDebouncedEffect } from "@/utils/react-use";

const FILE_MENTION_LIMIT = 8;
const MENTION_QUERY_DEBOUNCE_MS = 120;
const TEXTAREA_MAX_HEIGHT = 200;

interface TaskPromptComposerProps {
	id?: string;
	value: string;
	onValueChange: (value: string) => void;
	onSubmit?: () => void;
	onSubmitAndStart?: () => void;
	onEscape?: () => void;
	placeholder?: string;
	disabled?: boolean;
	enabled?: boolean;
	autoFocus?: boolean;
	workspaceId?: string | null;
}

export function TaskPromptComposer({
	id,
	value,
	onValueChange,
	onSubmit,
	onSubmitAndStart,
	onEscape,
	placeholder,
	disabled,
	enabled = true,
	autoFocus = false,
	workspaceId = null,
}: TaskPromptComposerProps): ReactElement {
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
	const mentionSearchRequestIdRef = useRef(0);
	const [cursorIndex, setCursorIndex] = useState(0);
	const [mentionItems, setMentionItems] = useState<InlineCompletionItem[]>([]);
	const [mentionInsertTextMap, setMentionInsertTextMap] = useState(new Map<string, string>());
	const [isMentionSearchLoading, setIsMentionSearchLoading] = useState(false);
	const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
	const [isSuggestionPickerOpen, setIsSuggestionPickerOpen] = useState(false);

	const autoResizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
	}, []);

	useEffect(() => {
		autoResizeTextarea();
	}, [autoResizeTextarea, value]);

	const activeToken = useMemo(() => {
		return detectActiveTaskPromptMention(value, cursorIndex);
	}, [cursorIndex, value]);

	useEffect(() => {
		if (!enabled || !activeToken) {
			mentionSearchRequestIdRef.current += 1;
			setMentionItems([]);
			setMentionInsertTextMap(new Map());
			setIsMentionSearchLoading(false);
		}
	}, [activeToken, enabled, workspaceId]);

	useDebouncedEffect(
		() => {
			if (!enabled || !activeToken || !workspaceId) {
				return;
			}
			const requestId = ++mentionSearchRequestIdRef.current;
			setIsMentionSearchLoading(true);
			void (async () => {
				try {
					const trpcClient = getRuntimeTrpcClient(workspaceId);
					const payload = await trpcClient.workspace.searchFiles.query({
						query: activeToken.query,
						limit: FILE_MENTION_LIMIT,
					});
					if (requestId !== mentionSearchRequestIdRef.current) {
						return;
					}
					const files = Array.isArray(payload.files) ? payload.files : [];
					const insertMap = new Map<string, string>();
					const items: InlineCompletionItem[] = files.map((file) => {
						const insertText = buildMentionInsertText(file.path);
						insertMap.set(file.path, insertText);
						return { id: file.path, label: file.path };
					});
					setMentionItems(items);
					setMentionInsertTextMap(insertMap);
				} catch {
					if (requestId === mentionSearchRequestIdRef.current) {
						setMentionItems([]);
						setMentionInsertTextMap(new Map());
					}
				} finally {
					if (requestId === mentionSearchRequestIdRef.current) {
						setIsMentionSearchLoading(false);
					}
				}
			})();
		},
		MENTION_QUERY_DEBOUNCE_MS,
		[activeToken, enabled, workspaceId],
	);

	const suggestions = useMemo(() => {
		return enabled && activeToken ? mentionItems : [];
	}, [activeToken, enabled, mentionItems]);

	useEffect(() => {
		setSelectedSuggestionIndex(0);
		setIsSuggestionPickerOpen(true);
	}, [activeToken?.query, activeToken?.start]);

	useEffect(() => {
		if (!autoFocus || disabled || !enabled) {
			return;
		}
		window.requestAnimationFrame(() => {
			if (!textareaRef.current) {
				return;
			}
			const cursor = textareaRef.current.value.length;
			textareaRef.current.focus();
			textareaRef.current.setSelectionRange(cursor, cursor);
			setCursorIndex(cursor);
		});
	}, [autoFocus, disabled, enabled]);

	const applySuggestion = useCallback(
		(item: InlineCompletionItem) => {
			if (!activeToken) {
				return;
			}
			const insertText = mentionInsertTextMap.get(item.id) ?? `@${item.id}`;
			const next = applyTaskPromptCompletion(value, activeToken, insertText);
			onValueChange(next.value);
			window.requestAnimationFrame(() => {
				if (!textareaRef.current) {
					return;
				}
				textareaRef.current.focus();
				textareaRef.current.setSelectionRange(next.cursor, next.cursor);
				setCursorIndex(next.cursor);
			});
		},
		[activeToken, mentionInsertTextMap, onValueChange, value],
	);

	const handleTextareaKeyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				if (event.shiftKey) {
					if (onSubmitAndStart) {
						onSubmitAndStart();
						return;
					}
				}
				onSubmit?.();
				return;
			}

			const canShowSuggestions = isSuggestionPickerOpen && suggestions.length > 0;
			if (canShowSuggestions && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
				event.preventDefault();
				const direction = event.key === "ArrowDown" ? 1 : -1;
				setSelectedSuggestionIndex((index) => {
					const nextIndex = index + direction;
					if (nextIndex < 0) {
						return suggestions.length - 1;
					}
					if (nextIndex >= suggestions.length) {
						return 0;
					}
					return nextIndex;
				});
				return;
			}

			if (canShowSuggestions && (event.key === "Tab" || (event.key === "Enter" && !event.shiftKey))) {
				event.preventDefault();
				const selectedItem = suggestions[selectedSuggestionIndex] ?? suggestions[0];
				if (selectedItem) {
					applySuggestion(selectedItem);
				}
				return;
			}

			if (event.key === "Escape" && canShowSuggestions) {
				event.preventDefault();
				setIsSuggestionPickerOpen(false);
				return;
			}

			if (event.key === "Escape") {
				event.preventDefault();
				onEscape?.();
			}
		},
		[
			applySuggestion,
			isSuggestionPickerOpen,
			onEscape,
			onSubmit,
			onSubmitAndStart,
			selectedSuggestionIndex,
			suggestions,
		],
	);

	const showSuggestions = Boolean(enabled && isSuggestionPickerOpen && activeToken);

	return (
		<div>
			<div className="relative">
				<InlineCompletionPicker
					open={showSuggestions}
					items={suggestions}
					selectedIndex={selectedSuggestionIndex}
					onSelectItem={applySuggestion}
					onHoverItem={setSelectedSuggestionIndex}
					isLoading={isMentionSearchLoading}
					loadingMessage="Loading files..."
					emptyMessage="No matching files."
				>
					<textarea
						id={id}
						ref={textareaRef}
						value={value}
						onChange={(event) => {
							onValueChange(event.target.value);
							setCursorIndex(event.target.selectionStart ?? event.target.value.length);
						}}
						onKeyDown={handleTextareaKeyDown}
						onClick={(event) =>
							setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
						}
						onKeyUp={(event) =>
							setCursorIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)
						}
						placeholder={placeholder ?? "Describe the task"}
						disabled={disabled}
						className={cn(
							"w-full rounded-md border border-border-bright bg-surface-3 p-3 text-[13px] text-text-primary placeholder:text-text-tertiary focus:border-border-focus focus:outline-none",
						)}
						style={{
							minHeight: 80,
							maxHeight: TEXTAREA_MAX_HEIGHT,
							resize: "none",
							overflowY: "auto",
						}}
					/>
				</InlineCompletionPicker>
			</div>
		</div>
	);
}
