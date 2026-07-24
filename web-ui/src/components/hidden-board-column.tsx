import { Eye } from "lucide-react";

import { ColumnIndicator } from "@/components/ui/column-indicator";
import type { BoardColumn } from "@/types";

export function HiddenBoardColumn({ column, onShow }: { column: BoardColumn; onShow: () => void }): React.ReactElement {
	const label = `Show ${column.title} column`;

	return (
		<aside
			className="flex w-10 shrink-0 overflow-hidden rounded-lg border border-border bg-surface-1"
			aria-label={`${column.title} column hidden`}
		>
			<button
				type="button"
				onClick={onShow}
				aria-label={label}
				title={label}
				className="flex min-h-0 w-full cursor-pointer flex-col items-center gap-2 py-2 text-text-secondary hover:bg-surface-3 hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
			>
				<Eye size={14} className="shrink-0" />
				<ColumnIndicator columnId={column.id} />
				<span className="text-xs font-semibold [writing-mode:vertical-rl] rotate-180">{column.title}</span>
				<span className="mt-auto text-[11px] text-text-tertiary">{column.cards.length}</span>
			</button>
		</aside>
	);
}
