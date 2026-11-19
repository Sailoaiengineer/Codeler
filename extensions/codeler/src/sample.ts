// What the panels show before a real team is loaded (signed out, or no project set): nothing.
// Real people, messages, activity and teams come from Convex.
export const sample = {
	people: [] as { name: string; initials: string; color: string; cursorLine: number; online: boolean }[],
	chat: [] as { who: string; time: string; text: string }[],
	activity: [] as { who: string; time: string; text: string }[],
	teams: [] as { name: string; role: string; projects: string[]; pending: number }[],
};
