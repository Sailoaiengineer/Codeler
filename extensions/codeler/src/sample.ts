// shortcut: layout-preview data copied from the reference image, until real teams come from Convex (login step).
export const sample = {
	people: [
		{ name: 'Alex', initials: 'A', color: '#3fbf5c', cursorLine: 2, online: true },
		{ name: 'Jordan', initials: 'J', color: '#2684f5', cursorLine: 12, online: true },
		{ name: 'Taylor', initials: 'T', color: '#f2842b', cursorLine: 10, online: true },
		{ name: 'Sam', initials: 'S', color: '#b26bd1', cursorLine: 5, online: true },
	],
	chat: [
		{ who: 'Alex', time: '10:24 AM', text: 'Just pushed the initial server setup! 🎉 Let me know if you see anything weird.' },
		{ who: 'Jordan', time: '10:26 AM', text: "Looks great! I'm **adding the collaboration** logic now. Should be ready in a few minutes." },
		{ who: 'Taylor', time: '10:27 AM', text: "Nice! I'll wire up the chat panel UI." },
		{ who: 'Sam', time: '10:28 AM', text: "I'm on the routes file. Will push shortly." },
		{ who: 'Alex', time: '10:31 AM', text: 'Awesome! Everything looks good so far. The cursors are working 🎯' },
		{ who: 'Jordan', time: '10:33 AM', text: 'Pushed the collaboration events. See the console logs in your terminal.' },
		{ who: 'Taylor', time: '10:34 AM', text: "Great! I'll add a small style tweak to the chat panel and then we should be good to test." },
		{ who: 'Sam', time: '10:36 AM', text: 'Perfect. Teamwork! 🙌' },
	],
	activity: [
		{ who: 'Sam', time: '10:36 AM', text: 'edited src/app.ts' },
		{ who: 'Jordan', time: '10:33 AM', text: 'saved a snapshot' },
		{ who: 'Taylor', time: '10:27 AM', text: 'opened components/ChatPanel.tsx' },
		{ who: 'Alex', time: '10:24 AM', text: 'ran npm run dev' },
	],
	teams: [
		{ name: 'Project Aurora', role: 'Owner', projects: ['project-aurora'], pending: 1 },
	],
};
