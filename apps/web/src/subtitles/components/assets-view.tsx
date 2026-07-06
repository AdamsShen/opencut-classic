import { Button } from "@/components/ui/button";
import { zh } from "@/locale/zh";
import { PanelView } from "@/components/editor/panels/assets/views/base-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useReducer, useRef, useState } from "react";
import { extractTimelineAudio } from "@/media/mediabunny";
import { useEditor } from "@/editor/use-editor";
import { TRANSCRIPTION_DIAGNOSTICS_SCOPE } from "@/transcription/diagnostics";
import { DEFAULT_TRANSCRIPTION_SAMPLE_RATE } from "@/transcription/audio";
import { TRANSCRIPTION_LANGUAGES } from "@/transcription/supported-languages";
import type {
	CaptionChunk,
	TranscriptionLanguage,
	TranscriptionModelId,
	TranscriptionProgress,
} from "@/transcription/types";
import { transcriptionService } from "@/services/transcription/service";
import { decodeAudioToFloat32 } from "@/media/audio";
import { buildCaptionChunks } from "@/transcription/caption";
import { insertCaptionChunksAsTextTrack } from "@/subtitles/insert";
import { parseSubtitleFile } from "@/subtitles/parse";
import { exportSrt, exportVtt } from "@/subtitles/export";
import { mediaTimeFromSeconds } from "@/wasm";
import { Spinner } from "@/components/ui/spinner";
import {
	Section,
	SectionContent,
	SectionField,
	SectionFields,
} from "@/components/section";
import {
	AlertCircleIcon,
	CloudUploadIcon,
	Download02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiagnosticSeverity } from "@/diagnostics/types";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TRANSCRIPTION_MODELS } from "@/transcription/models";
import { toast } from "sonner";

const DIAGNOSTIC_BUTTON_VARIANT: Record<
	DiagnosticSeverity,
	"caution" | "destructive-foreground"
> = {
	caution: "caution",
	error: "destructive-foreground",
};

type ProcessingState =
	| {
			status: "idle";
			error: string | null;
			warnings: string[];
			captions: CaptionChunk[];
	  }
	| { status: "processing"; step: string };

type ProcessingAction =
	| { type: "start"; step: string }
	| { type: "update_step"; step: string }
	| { type: "succeed"; captions: CaptionChunk[]; warnings: string[] }
	| { type: "fail"; error: string }
	| { type: "clear" };

const IDLE_STATE: ProcessingState = {
	status: "idle",
	error: null,
	warnings: [],
	captions: [],
};

/* eslint-disable opencut/prefer-object-params -- React reducers must accept (state, action). */
function processingReducer(
	state: ProcessingState,
	action: ProcessingAction,
): ProcessingState {
	switch (action.type) {
		case "start":
			return { status: "processing", step: action.step };
		case "update_step":
			if (state.status !== "processing") return state;
			return { status: "processing", step: action.step };
		case "succeed":
			return {
				status: "idle",
				error: null,
				warnings: action.warnings,
				captions: action.captions,
			};
		case "fail":
			return { status: "idle", error: action.error, warnings: [], captions: [] };
		case "clear":
			return { ...IDLE_STATE };
	}
}
/* eslint-enable opencut/prefer-object-params */

export function Captions() {
	const [selectedLanguage, setSelectedLanguage] =
		useState<TranscriptionLanguage>("auto");
	const [selectedModel, setSelectedModel] =
		useState<TranscriptionModelId>("whisper-small");
	const [processing, dispatch] = useReducer(processingReducer, IDLE_STATE);
	const containerRef = useRef<HTMLDivElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const editor = useEditor();

	const isProcessing = processing.status === "processing";
	const captions = processing.status === "idle" ? processing.captions : [];

	const activeDiagnostics = useEditor((e) =>
		e.diagnostics.getActive({ scope: TRANSCRIPTION_DIAGNOSTICS_SCOPE }),
	);

	const handleProgress = (progress: TranscriptionProgress) => {
		if (progress.status === "loading-model") {
			dispatch({
				type: "update_step",
				step: zh["captions.loading_model"].replace(
					"{progress}",
					String(Math.round(progress.progress)),
				),
			});
		} else if (progress.status === "transcribing") {
			dispatch({ type: "update_step", step: zh["captions.transcribing"] });
		}
	};

	const insertCaptions = ({
		captions,
	}: {
		captions: CaptionChunk[];
	}): boolean => {
		const trackId = insertCaptionChunksAsTextTrack({ editor, captions });
		return trackId !== null;
	};

	const handleGenerateTranscript = async () => {
		dispatch({ type: "start", step: zh["captions.extracting_audio"] });
		try {
			const audioBlob = await extractTimelineAudio({
				tracks: editor.scenes.getActiveScene().tracks,
				mediaAssets: editor.media.getAssets(),
				totalDuration: editor.timeline.getTotalDuration(),
			});

			dispatch({
				type: "update_step",
				step: zh["captions.preparing_audio"],
			});
			const { samples } = await decodeAudioToFloat32({
				audioBlob,
				sampleRate: DEFAULT_TRANSCRIPTION_SAMPLE_RATE,
			});

			const result = await transcriptionService.transcribe({
				audioData: samples,
				language: selectedLanguage === "auto" ? undefined : selectedLanguage,
				modelId: selectedModel,
				onProgress: handleProgress,
			});

			dispatch({
				type: "update_step",
				step: zh["captions.generating_captions"],
			});
			const captionChunks = buildCaptionChunks({ segments: result.segments });

			if (!insertCaptions({ captions: captionChunks })) {
				dispatch({ type: "fail", error: zh["captions.no_captions_generated"] });
				return;
			}

			// 语言检测反馈
			const detectedLang = result.language;
			if (detectedLang && selectedLanguage === "auto") {
				const langName =
					TRANSCRIPTION_LANGUAGES.find((l) => l.code === detectedLang)?.name ||
					detectedLang;
				toast.info(
					zh["captions.detected_language"].replace("{lang}", langName),
				);
			}

			dispatch({ type: "succeed", captions: captionChunks, warnings: [] });
		} catch (error) {
			if (
				error instanceof Error &&
				error.message === "Transcription cancelled"
			) {
				dispatch({ type: "clear" });
				return;
			}
			console.error("Transcription failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: zh["captions.no_captions_generated"],
			});
		}
	};

	const handleCancel = () => {
		transcriptionService.cancel();
	};

	const handleImportClick = () => {
		fileInputRef.current?.click();
	};

	const handleImportFile = async ({ file }: { file: File }) => {
		dispatch({ type: "start", step: zh["captions.reading_file"] });
		try {
			const input = await file.text();
			const result = parseSubtitleFile({
				fileName: file.name,
				input,
			});

			if (result.captions.length === 0) {
				dispatch({
					type: "fail",
					error: "No valid subtitle cues were found in the subtitle file",
				});
				return;
			}

			dispatch({ type: "update_step", step: zh["captions.importing"] });

			if (!insertCaptions({ captions: result.captions })) {
				dispatch({ type: "fail", error: zh["captions.no_captions_generated"] });
				return;
			}

			const nextWarnings = [...result.warnings];
			if (result.skippedCueCount > 0) {
				nextWarnings.unshift(
					zh["captions.import_result"]
						.replace("{count}", String(result.captions.length))
						.replace("{skipped}", String(result.skippedCueCount)),
				);
			}

			dispatch({
				type: "succeed",
				captions: result.captions,
				warnings: nextWarnings,
			});
		} catch (error) {
			console.error("Subtitle import failed:", error);
			dispatch({
				type: "fail",
				error:
					error instanceof Error
						? error.message
						: "An unexpected error occurred",
			});
		}
	};

	const handleFileChange = async ({
		event,
	}: {
		event: React.ChangeEvent<HTMLInputElement>;
	}) => {
		const file = event.target.files?.[0];
		if (event.target) {
			event.target.value = "";
		}
		if (!file) return;

		await handleImportFile({ file });
	};

	const handleLanguageChange = ({ value }: { value: string }) => {
		if (value === "auto") {
			setSelectedLanguage("auto");
			return;
		}

		const matchedLanguage = TRANSCRIPTION_LANGUAGES.find(
			(language) => language.code === value,
		);
		if (!matchedLanguage) return;
		setSelectedLanguage(matchedLanguage.code);
	};

	const handleModelChange = ({ value }: { value: string }) => {
		const matched = TRANSCRIPTION_MODELS.find((m) => m.id === value);
		if (matched) {
			setSelectedModel(matched.id);
		}
	};

	const handleExport = async (format: "srt" | "vtt") => {
		if (captions.length === 0) {
			toast.error(zh["captions.no_captions"]);
			return;
		}
		const content =
			format === "srt"
				? exportSrt({ captions })
				: exportVtt({ captions });
		const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `subtitles.${format}`;
		a.click();
		URL.revokeObjectURL(url);
	};

	const handleClearCaptions = () => {
		dispatch({ type: "clear" });
		toast.success(zh["captions.clear_all"]);
	};

	const handleJumpToTime = (time: number) => {
		editor.playback.seek({ time: mediaTimeFromSeconds({ seconds: time }) });
	};

	const formatTime = (seconds: number): string => {
		const m = Math.floor(seconds / 60);
		const s = Math.floor(seconds % 60);
		return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	};

	const error = processing.status === "idle" ? processing.error : null;
	const warnings = processing.status === "idle" ? processing.warnings : [];

	return (
		<PanelView
			title={zh["tab.captions"]}
			contentClassName="px-0 flex flex-col h-full"
			actions={
				<TooltipProvider>
					<div className="flex items-center gap-1.5">
						{!isProcessing &&
							activeDiagnostics.map((diagnostic) => (
								<Tooltip key={diagnostic.id}>
									<TooltipTrigger asChild>
										<Button
											variant={DIAGNOSTIC_BUTTON_VARIANT[diagnostic.severity]}
											size="icon"
											aria-label={diagnostic.message}
										>
											<HugeiconsIcon icon={AlertCircleIcon} size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent>{diagnostic.message}</TooltipContent>
								</Tooltip>
							))}
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={handleImportClick}
							disabled={isProcessing}
							className="items-center justify-center gap-1.5"
						>
							<HugeiconsIcon icon={CloudUploadIcon} />
							{zh["captions.import"]}
						</Button>
						{captions.length > 0 && (
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="items-center justify-center gap-1.5"
									>
										<HugeiconsIcon icon={Download02Icon} />
										{zh["captions.export"]}
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => handleExport("srt")}>
										{zh["captions.export_srt"]}
									</DropdownMenuItem>
									<DropdownMenuItem onClick={() => handleExport("vtt")}>
										{zh["captions.export_vtt"]}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						)}
					</div>
				</TooltipProvider>
			}
			ref={containerRef}
		>
			<input
				ref={fileInputRef}
				type="file"
				accept=".srt,.ass"
				className="hidden"
				onChange={(event) => void handleFileChange({ event })}
			/>
			<Section
				showTopBorder={false}
				showBottomBorder={false}
				className="flex-1"
			>
				<SectionContent className="flex flex-col gap-4 h-full pt-1">
					<SectionFields>
						<SectionField label={zh["captions.language"]}>
							<Select
								value={selectedLanguage}
								onValueChange={(value) => handleLanguageChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder={zh["captions.language"]} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">
										{zh["captions.auto_detect"]}
									</SelectItem>
									{TRANSCRIPTION_LANGUAGES.map((language) => (
										<SelectItem key={language.code} value={language.code}>
											{language.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>

						<SectionField label={zh["captions.model"]}>
							<Select
								value={selectedModel}
								onValueChange={(value) => handleModelChange({ value })}
							>
								<SelectTrigger>
									<SelectValue placeholder={zh["captions.model"]} />
								</SelectTrigger>
								<SelectContent>
									{TRANSCRIPTION_MODELS.map((model) => (
										<SelectItem key={model.id} value={model.id}>
											{model.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</SectionField>
					</SectionFields>

					<div className="flex gap-2">
						<Button
							type="button"
							className="flex-1"
							onClick={handleGenerateTranscript}
							disabled={isProcessing || activeDiagnostics.length > 0}
						>
							{isProcessing && <Spinner className="mr-1" />}
							{isProcessing
								? processing.step
								: zh["captions.generate"]}
						</Button>
						{isProcessing && (
							<Button
								type="button"
								variant="outline"
								onClick={handleCancel}
							>
								{zh["captions.cancel"]}
							</Button>
						)}
					</div>

					{/* 字幕预览列表 */}
					{captions.length > 0 && (
						<div className="flex flex-col gap-1 min-h-0">
							<div className="flex items-center justify-between">
								<span className="text-muted-foreground text-xs">
									{zh["captions.transcribe"]}（{captions.length}）
								</span>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={handleClearCaptions}
									className="h-6 text-xs text-muted-foreground hover:text-destructive"
								>
									{zh["captions.clear_all"]}
								</Button>
							</div>
							<div className="scrollbar-hidden max-h-[200px] overflow-y-auto rounded-md border">
								{captions.map((caption, index) => (
									<button
										key={`${caption.startTime}-${index}`}
										type="button"
										className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors border-b last:border-b-0"
										onClick={() => handleJumpToTime(caption.startTime)}
									>
										<span className="text-muted-foreground w-6 shrink-0 tabular-nums">
											{index + 1}
										</span>
										<span className="text-muted-foreground w-12 shrink-0 tabular-nums">
											{formatTime(caption.startTime)}
										</span>
										<span className="truncate">
											{caption.text}
										</span>
									</button>
								))}
							</div>
						</div>
					)}

					{error && (
						<div className="bg-destructive/10 border-destructive/20 rounded-md border p-3">
							<p className="text-destructive text-sm">{error}</p>
						</div>
					)}
					{warnings.length > 0 && (
						<div className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3">
							<ul className="space-y-1 text-sm text-amber-700">
								{warnings.map((warning) => (
									<li key={warning}>{warning}</li>
								))}
							</ul>
						</div>
					)}
				</SectionContent>
			</Section>
		</PanelView>
	);
}
