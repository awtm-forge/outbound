// When a person, a script or a webhook last used the app. The scheduler's own work is not counted, so it cannot keep
// itself (and the database) awake: with nobody around, Neon's compute suspends and its free hours are not spent.
let last = Date.now(); // a fresh boot counts, so one sync runs after a deploy
export const markActivity = () => { last = Date.now(); };
export const lastActivity = () => last;
