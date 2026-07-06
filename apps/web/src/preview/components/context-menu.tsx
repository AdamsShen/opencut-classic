"use client";
import { zh } from "@/locale/zh";

import {
	ContextMenuCheckboxItem,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import { useEditor } from "@/editor/use-editor";
import type { PreviewOverlayControl } from "@/preview/overlays";
import { toast } from "sonner";

export function PreviewContextMenu({
	onToggleFullscreen,
	container,
	overlayControls,
	onOverlayVisibilityChange,
}: {
	onToggleFullscreen: () => void;
	container: HTMLElement | null;
	overlayControls: PreviewOverlayControl[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const editor = useEditor();
	const viewport = usePreviewViewport();

	const handleCopySnapshot = async () => {
		const result = await editor.renderer.copySnapshot();

		if (!result.success) {
			toast.error(zh["toast.failed_copy_snapshot"], {
				description: result.error ?? zh["toast.please_try_again"],
			});
			return;
		}
	};

	const handleSaveSnapshot = async () => {
		const result = await editor.renderer.saveSnapshot();

		if (!result.success) {
			toast.error(zh["toast.failed_save_snapshot"], {
				description: result.error ?? zh["toast.please_try_again"],
			});
			return;
		}
	};

	return (
		<ContextMenuContent className="w-56" container={container}>
			<ContextMenuItem onClick={viewport.fitToScreen} inset>
				Fit to screen
			</ContextMenuItem>
			<ContextMenuSeparator />
			<ContextMenuItem onClick={onToggleFullscreen} inset>
				Full screen
			</ContextMenuItem>
			<ContextMenuItem onClick={handleSaveSnapshot} inset>
				Save snapshot
			</ContextMenuItem>
			<ContextMenuItem onClick={handleCopySnapshot} inset>
				Copy snapshot
			</ContextMenuItem>
			{overlayControls.length > 0 ? <ContextMenuSeparator /> : null}
			{overlayControls.map((overlayControl) => (
				<ContextMenuCheckboxItem
					key={overlayControl.id}
					checked={overlayControl.isVisible}
					onCheckedChange={(checked) =>
						onOverlayVisibilityChange({
							overlayId: overlayControl.id,
							isVisible: !!checked,
						})
					}
				>
					{overlayControl.label}
				</ContextMenuCheckboxItem>
			))}
		</ContextMenuContent>
	);
}
