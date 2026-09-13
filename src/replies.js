// Deliberately local and deterministic. This is not an AI model or a request queue.
export function createReply(input) {
  const text = input.toLowerCase();
  let reply;
  if (/photosynth|plants? (make|grow)|sunlight/.test(text)) {
    reply = 'Think of a leaf as a tiny solar-powered kitchen.\n\nPlants use energy from sunlight to turn water and carbon dioxide into sugar. The sugar fuels their growth, and oxygen is released along the way. This process is called photosynthesis.\n\nTry this: draw a leaf. Add arrows for sunlight, water, and carbon dioxide going in, then sugar and oxygen coming out.\n\nA question to explore: why might a plant grow more slowly in a dark room?';
  } else if (/plan|study|routine|schedule/.test(text)) {
    reply = 'Here’s a simple study plan you can adapt, with or without a connection.\n\n1. Choose one small goal. Write down what you want to understand by the end.\n2. Explore for 15 minutes. Use a book, your notes, or a resource you already have.\n3. Close your notes. Spend 5 minutes explaining the idea in your own words.\n4. Check the gaps. Revisit what you missed and write one question for next time.\n5. Return tomorrow. A short review helps more than one long session.\n\nStart here: what is one thing you’d like to learn this week?';
  } else if (/write|story|inspir|creativ|ideas/.test(text)) {
    reply = 'A small creative exercise: find something extraordinary in an ordinary place.\n\nStart with this line: “The path had always ended here. Today, it didn’t.”\n\nChoose a character, give them something they’re looking for, and add one unexpected detail. Write for five minutes without editing.\n\nIf you’re stuck, look around and include the first three things you notice. A good idea doesn’t need a perfect beginning.';
  } else if (/math|solve|problem|step/.test(text)) {
    reply = 'Let’s give your problem a little structure.\n\n1. Restate the question in your own words. What do you need to find?\n2. List what you know. Include numbers, facts, and any constraints.\n3. Try a smaller example or draw a picture.\n4. Work through one step at a time, explaining why it makes sense.\n5. Check your result against the original question.\n\nFor example: if 3 notebooks cost 12 coins, one costs 12 ÷ 3 = 4 coins. Five would cost 5 × 4 = 20 coins.\n\nWrite down the first step you could try with your own problem.';
  } else if (/explain|learn|understand|teach/.test(text)) {
    reply = 'One of the best ways to understand an idea is to explain it simply.\n\nTry this little learning loop:\n\n1. Write what you already know about the topic.\n2. Explain it as if you were teaching a younger friend.\n3. Circle any words you can’t easily explain. Those are your next learning steps.\n4. Connect the idea to something from everyday life.\n\nYou can try “Explain photosynthesis simply” for a short lesson that’s included in this offline demo.';
  } else {
    reply = 'You’ve got a space to think here, even without a signal. This offline companion has a few built-in starting points rather than a live AI model.\n\nTry asking me to explain photosynthesis, make a study plan, share a story prompt, or work through a problem step by step.\n\nYou can also use this conversation as a notebook. Your messages stay in this browser when local storage is available, ready for you to return to.';
  }
  return reply;
}
