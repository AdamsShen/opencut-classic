import type { MutableRefObject } from "react";
import { ACTIONS, type TAction } from "./definitions";

export type { TAction };

export type TActionArgsMap = {
	"seek-forward": { seconds: number } | undefined;
	"seek-backward": { seconds: number } | undefined;
	"jump-forward": { seconds: number } | undefined;
	"jump-backward": { seconds: number } | undefined;
	"remove-media-asset": { projectId: string; assetId: string };
	"remove-media-assets": { projectId: string; assetIds: string[] };
};

type TKeysWithValueUndefined<T> = {
	[K in keyof T]: undefined extends T[K] ? K : never;
}[keyof T];

export type TActionWithArgs = keyof TActionArgsMap;

export type TActionWithOptionalArgs =
	| TActionWithNoArgs
	| TKeysWithValueUndefined<TActionArgsMap>;

export type TActionWithNoArgs = Exclude<TAction, TActionWithArgs>;

export type TArgOfAction<A extends TAction> = A extends TActionWithArgs
	? TActionArgsMap[A]
	: undefined;

export type TActionFunc<A extends TAction> = A extends TActionWithArgs
	? (arg: TArgOfAction<A>, trigger?: TInvocationTrigger) => void
	: (_?: undefined, trigger?: TInvocationTrigger) => void;

export type TInvocationTrigger = "keypress" | "mouseclick";

export type TBoundActionList = {
	[A in TAction]?: Array<TActionFunc<A>>;
};

export type TActionHandlerOptions =
	| MutableRefObject<boolean>
	| boolean
	| undefined;

/**
 * 需要必传参数的 action 名称集合。
 * 不在该集合中的 action 均属于 TActionWithOptionalArgs（无需参数或参数可选）。
 */
const REQUIRED_ARGS_ACTIONS: ReadonlySet<string> = new Set<string>([
	"remove-media-asset",
	"remove-media-assets",
]);

/**
 * 运行时校验一个字符串是否为合法的 TActionWithOptionalArgs。
 * 用于反序列化 / 导入数据的合法性校验。
 */
export function isActionWithOptionalArgs(value: unknown): value is TActionWithOptionalArgs {
	return (
		typeof value === "string" &&
		value in ACTIONS &&
		!REQUIRED_ARGS_ACTIONS.has(value)
	);
}
