// Gristlemaw's stock lines: recorded once, shared by every player, so the Fight can speak the instant something happens.
// Words in [brackets] are Eleven v3 delivery tags (heard, not shown). Keep lines general: no quest names or numbers.
export const STOCK: Record<string, string[]> = {
  // he ate a quest left out past its time
  chomp: [
    "[growls] Mine. All mine.",
    "Crunchy. You should leave them out more often.",
    "[laughs] Thank you for your donation.",
    "Mm. Tastes like procrastination.",
    "Delicious. My compliments to whoever ignored it.",
    "Gone. Don't worry, it went somewhere warm.",
    "Chomp. I do love a quest left out to marinate.",
    "[chuckles] You looked away. I didn't.",
    "Another one for the hoard. The pile grows.",
    "Was that important? Too late. It was tasty.",
    "Ah. Seasoned with a little guilt. My favourite.",
    "You snooze, I chew.",
  ],
  // he took the richest one early
  swoop: [
    "[laughs] I couldn't wait. Swoop!",
    "Early? I prefer the word eager.",
    "Surprise. I eat on my own schedule.",
    "Swooped. Nobody said I had to play fair.",
    "The richest one, right off the top. Thank you.",
    "I smelled the gold and simply had to.",
  ],
  // they finished one in time
  kept: [
    "[sighs] Fine. Keep it.",
    "Hmph. Lucky.",
    "That one was mine. I had a bib on.",
    "Well done. I hate it.",
    "[growls] Show-off.",
    "Ugh. Productive. How tiresome.",
    "Fine. I wasn't hungry for that one anyway.",
    "You're making a dragon very sad.",
    "Again? Are you feeling alright?",
    "That's my lunch walking away.",
    "Grr. Into your purse it goes.",
    "I'll remember that.",
  ],
  // they finished one after he ate it, and wrestled half back
  late: [
    "[coughs] Fine! Take half. Greedy little thing.",
    "You chased me down for that? Have some dignity.",
    "Half. You get half. Don't push it.",
    "[grumbles] I was still chewing that.",
    "Snatching gold from a dragon's teeth. Bold.",
    "Late, but here you are. Take your crumbs.",
  ],
  // a quest just reached his jaws
  jaws: [
    "Ooh. Here comes dinner.",
    "[sniffs] I can smell that one from here.",
    "It's in my mouth now. Tick tock.",
    "Ahh. Right between the teeth.",
    "Hurry, hurry. Or don't. Please don't.",
    "Come to me, little quest.",
    "I've got this one by the tail.",
    "That's sitting on my tongue. Your move.",
  ],
  // a tap on his head
  poke: [
    "[growls] Do that again. I dare you.",
    "Hey! That's my good scale.",
    "Poking a dragon. A bold plan.",
    "I'm not a doorbell.",
    "[laughs] That tickles. Get back to work.",
    "Did you need something? Besides more time?",
    "Stop poking me and go do something.",
    "Careful. I bite things that poke me.",
    "Ow. Rude. I'm telling the other dragons.",
    "You know poking me isn't a task, right?",
    "Mm? Oh, it's you. The one with the list.",
    "Every poke is a minute I'm not hungry. Kidding. I'm always hungry.",
  ],
  // they won a round
  won: [
    "[sighs] That round's yours. Enjoy it while it lasts.",
    "You won the round. I wasn't really trying.",
    "Fine. Round to you. Next one's mine.",
    "Hmph. A lucky streak, that's all it is.",
    "You beat me. I'm going to sulk on my rock now.",
    "That round goes to you, little hero. Don't get used to it.",
  ],
  // he won a round
  lost: [
    "[laughs] That round is mine!",
    "Round to the dragon. As it should be.",
    "My hoard thanks you for that round.",
    "I win. Try harder. I like it when you try.",
    "Ha! Another round in my belly.",
    "Round over. I'll have seconds next round.",
  ],
  dawn: [
    "[yawns] I'm up. I'm hungry. Let's see your list.",
    "Morning. I can smell your to-do list from here.",
    "Another dawn, another menu.",
    "Good morning. I've already picked my favourite.",
    "Rise and shine. I certainly will.",
    "Stretch, yawn, count your quests. I already did.",
  ],
  bedtime: [
    "Bedtime. Put the phone down. I'll be here at dawn.",
    "[yawns] The day is done. Go to sleep.",
    "Off to bed. I'll count my coins in the dark.",
    "Sleep. Even dragons need it. Mostly you, though.",
  ],
  // the bedtime verdicts
  starves: [
    "[whimpers] Nothing. Not one coin. I'm starving.",
    "You fed me nothing today. I'm impressed. And hungry.",
    "An empty hoard. You monster.",
  ],
  driven: [
    "[grumbles] Fine. You drove me off. Today.",
    "Scraps. I got scraps. Enjoy your victory.",
    "You win the day. I'll be back at dawn, hungrier.",
  ],
  stuffed: [
    "[burps] Excuse me. That was a feast.",
    "I'm stuffed. Same time tomorrow?",
    "So full. Thank you for leaving it all out for me.",
  ],
};
