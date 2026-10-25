import { registerActions } from "../core/actions";
import { getState } from "../core/store";
import { stopSession, isActive } from "./session";
import { createShareLink } from "./share";
import { toggleScreenShare, toggleVoice } from "./rtc";
import { setCollab } from "./state";

const inRoom = () => isActive();

registerActions([
  {
    id: "collab.start",
    label: "Live collaboration…",
    category: "collab",
    keywords: ["share", "session", "room", "invite", "multiplayer", "together"],
    perform: (s) => {
      setCollab({ dialogTab: "live" });
      s.setAppState({ openDialog: "collab" });
    },
  },
  {
    id: "collab.stop",
    label: "Stop collaboration session",
    category: "collab",
    keywords: ["leave", "end", "disconnect"],
    predicate: inRoom,
    perform: () => stopSession(),
  },
  {
    id: "collab.shareLink",
    label: "Create read-only link…",
    category: "collab",
    keywords: ["share", "link", "export", "url", "embed", "view only"],
    perform: (s) => {
      setCollab({ dialogTab: "share", shareLink: null });
      s.setAppState({ openDialog: "collab" });
      void createShareLink();
    },
  },
  {
    id: "collab.toggleVoice",
    label: "Join / leave voice hangout",
    category: "collab",
    keywords: ["voice", "audio", "call", "microphone", "talk"],
    predicate: inRoom,
    perform: () => toggleVoice(),
  },
  {
    id: "collab.toggleScreenShare",
    label: "Start / stop screen sharing",
    category: "collab",
    keywords: ["screen", "share", "present", "video"],
    predicate: inRoom,
    perform: () => toggleScreenShare(),
  },
  {
    id: "collab.followStop",
    label: "Stop following",
    category: "collab",
    keywords: ["follow", "unfollow"],
    predicate: (s) => !!s.appState.followingUserId,
    perform: () => getState().setAppState({ followingUserId: null }),
  },
]);
