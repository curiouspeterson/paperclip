import type { AgentAdapterType } from "@paperclipai/shared";
import { listUIAdapters } from "../adapters";

export type InviteJoinAdapterOption = {
  type: AgentAdapterType;
  label: string;
  selectable: boolean;
  disabledLabel?: string;
};

export function listInviteJoinAdapterOptions(): InviteJoinAdapterOption[] {
  return listUIAdapters().map((adapter) => ({
    type: adapter.type as AgentAdapterType,
    label: adapter.label,
    selectable: adapter.inviteJoin?.selectable ?? true,
    disabledLabel: adapter.inviteJoin?.disabledLabel,
  }));
}
