// Backend/ai.js
const express = require('express');

// Optional: use OpenAI if API key present; otherwise return a rule-based stub
let openai = null;
try {
  const { OpenAI } = require('openai');
  if (process.env.OPENAI_API_KEY) openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch {}

const router = express.Router();

/**
 * POST /api/ai/insights
 * body: { positions:[{symbol,qty,avgPrice}], cashUsd, riskTolerance }
 */
router.post('/insights', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.positions)) return res.status(400).json({ error: 'positions[] required' });

    if (!openai) {
      const total = body.positions.reduce((s, p) => s + (p.qty * p.avgPrice), 0) + (body.cashUsd || 0);
      const top = [...body.positions].sort((a,b)=>b.qty*b.avgPrice - a.qty*a.avgPrice).slice(0,3).map(p=>p.symbol);
      return res.json({
        model: 'rule-based',
        summary: `Total exposure ~ $${total.toFixed(2)}. Concentration in ${top.join(', ')}.`,
        tips: [
          'Cap any single position at ≤ 25% of portfolio.',
          'Keep 6–12 months of cash runway.',
          'Prefer limit orders; avoid chasing breakouts.'
        ]
      });
    }

    const prompt = `
You are a trading coach. User portfolio (USD):
${JSON.stringify(body, null, 2)}

1) Give a 2–3 sentence overview of concentration and cash runway.
2) List 3 tactical suggestions (concise bullets).
3) List 2 risk controls (concise bullets).
Avoid absolute promises; education only.
`;
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3
    });

    res.json({ model: 'gpt-4o-mini', text: completion.choices[0].message.content });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
