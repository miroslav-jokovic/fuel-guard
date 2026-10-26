import { computed, ref, type Ref } from "vue";
import type { ChatTeam } from "@silvicom/shared";
import { useConfirm } from "@silvicom/ui";
import { useToastStore } from "@/stores/toast";
import { genUuid } from "@/lib/uuid";
import { useChatPeopleQuery } from "../useChat";
import { useAddTeamMembers, useCreateChannel, useJoinChannel, useLeaveTeam, useTeamMembersQuery } from "./useChatTeams";
import { useCreateTeam } from "./useChatTeamsAdmin";

/**
 * The acts a person takes from the rail on a team (OFFICE-CHAT-PLAN CH5c, moved out of the Teams view
 * when the rail became one list — CHAT-REDESIGN-PLAN D-CHATUI2): join a public channel, make a channel
 * in a team, add people to a team you own, leave a team, make a team. Each dialog's "which team" is a
 * ref here, so `ChatPage` keeps the dialogs and this keeps the mutations and the two people lists they
 * need — New channel and Add people want the team's people, New team and Add people the office's.
 */
export function useChatRailActions(entitled: Ref<boolean>, openChannel: (id: string) => void, backToRail: () => void) {
  const toast = useToastStore();
  const confirmAsk = useConfirm();
  const fail = (fallback: string) => (e: unknown) => toast.error(e instanceof Error ? e.message : fallback);

  const channelFor = ref<ChatTeam | null>(null);
  const peopleFor = ref<ChatTeam | null>(null);
  const creatingTeam = ref(false);
  const membersOf = computed(() => channelFor.value?.space_id ?? peopleFor.value?.space_id ?? null);
  const members = useTeamMembersQuery(membersOf);
  const people = useChatPeopleQuery(computed(() => entitled.value && (creatingTeam.value || peopleFor.value !== null)));

  const join = useJoinChannel();
  async function onJoin(id: string) {
    try {
      await join.mutateAsync(id);
      openChannel(id);
    } catch (e) {
      fail("Could not join the channel.")(e);
    }
  }

  const leaveTeam = useLeaveTeam();
  async function onLeaveTeam(t: ChatTeam) {
    const ok = await confirmAsk({
      title: `Leave ${t.name}?`,
      message: "You leave every channel in it too. Somebody in the team will have to add you back.",
      confirmLabel: "Leave team",
      tone: "danger",
    });
    if (!ok) return;
    await leaveTeam.mutateAsync(t.space_id).then(backToRail, fail("Could not leave the team."));
  }

  const createChannel = useCreateChannel();
  async function onCreateChannel(name: string, visibility: "public" | "private", memberIds: string[]) {
    const t = channelFor.value;
    if (!t) return;
    try {
      const id = await createChannel.mutateAsync({ spaceId: t.space_id, name, visibility, memberIds });
      channelFor.value = null;
      openChannel(id);
    } catch (e) {
      fail("Could not make the channel.")(e);
    }
  }

  const addPeople = useAddTeamMembers();
  async function onAddPeople(userIds: string[]) {
    const t = peopleFor.value;
    if (!t) return;
    try {
      await addPeople.mutateAsync({ spaceId: t.space_id, userIds });
      toast.success(userIds.length === 1 ? "Added to the team." : `${userIds.length} people added to the team.`);
      peopleFor.value = null;
    } catch (e) {
      fail("Could not add those people.")(e);
    }
  }

  const createTeam = useCreateTeam();
  async function onCreateTeam(name: string, description: string | null, memberIds: string[]) {
    const generalId = genUuid();
    try {
      await createTeam.mutateAsync({ space_id: genUuid(), general_id: generalId, name, description, member_ids: memberIds });
      creatingTeam.value = false;
      openChannel(generalId);
    } catch (e) {
      fail("Could not make the team.")(e);
    }
  }

  return {
    channelFor,
    peopleFor,
    creatingTeam,
    members,
    people,
    onJoin,
    onLeaveTeam,
    onCreateChannel,
    onAddPeople,
    onCreateTeam,
    createChannelBusy: computed(() => createChannel.isPending.value),
    addPeopleBusy: computed(() => addPeople.isPending.value),
    createTeamBusy: computed(() => createTeam.isPending.value),
  };
}
