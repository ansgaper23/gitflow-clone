import { Router } from 'express'
import { supabase } from '../db/supabaseClient.js'
import { requireAuth } from '../middleware/auth.js'

export const agentsRouter = Router()

agentsRouter.use(requireAuth)

// GET /api/agents
agentsRouter.get('/', async (req, res) => {
  try {
    const userId = req.user.id
    const { data, error } = await supabase
      .from('custom_agents')
      .select('*')
      .or(`owner_id.eq.${userId},is_public.eq.true`)
      .order('created_at', { ascending: false })
      
    if (error) {
      // If table doesn't exist, return empty array gracefully
      if (error.code === '42P01') {
        return res.json({ agents: [] })
      }
      throw error
    }
    
    res.json({ agents: data })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// POST /api/agents
agentsRouter.post('/', async (req, res) => {
  try {
    const userId = req.user.id
    const { name, icon, description, system_prompt } = req.body
    
    const { data, error } = await supabase
      .from('custom_agents')
      .insert({
        owner_id: userId,
        name,
        icon,
        description,
        system_prompt
      })
      .select()
      .single()
      
    if (error) throw error
    res.json({ agent: data })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// PATCH /api/agents/:id
agentsRouter.patch('/:id', async (req, res) => {
  try {
    const userId = req.user.id
    const agentId = req.params.id
    const { name, icon, description, system_prompt } = req.body
    
    const { data, error } = await supabase
      .from('custom_agents')
      .update({
        name,
        icon,
        description,
        system_prompt
      })
      .eq('id', agentId)
      .eq('owner_id', userId)
      .select()
      .single()
      
    if (error) throw error
    res.json({ agent: data })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// DELETE /api/agents/:id
agentsRouter.delete('/:id', async (req, res) => {
  try {
    const userId = req.user.id
    const agentId = req.params.id
    
    const { error } = await supabase
      .from('custom_agents')
      .delete()
      .eq('id', agentId)
      .eq('owner_id', userId)
      
    if (error) throw error
    res.json({ success: true })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
