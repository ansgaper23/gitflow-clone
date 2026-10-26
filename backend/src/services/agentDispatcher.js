import { supabase } from '../db/supabaseClient.js';
import { triggerAutoTurn } from './conversationTurn.js';

export async function dispatchAgentTask({ projectId, prompt, intent }) {
  // Find the most recent conversation for this project (repo_full_name)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, user_id')
    .eq('repo_full_name', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!conv) {
    throw new Error('No conversation found for this project');
  }

  // Create a minimal user object since triggerAutoTurn expects it
  const dummyUser = { id: conv.user_id };

  // Note: intent is passed as prefix or we just pass the prompt
  // In FlowPro, we can just prepend a system hint or use the prompt directly
  const finalPrompt = `[INTENT: ${intent}]\n\n${prompt}`;

  // This runs asynchronously in the background
  triggerAutoTurn(dummyUser, conv.id, finalPrompt);
}
