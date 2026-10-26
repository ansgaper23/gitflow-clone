import { Router } from 'express'
import { requireAuth, requireGithub } from '../middleware/auth.js'
import { listUserRepos, getRepoTree, getFileContent, sendGithubAwareError } from '../services/github.js'

export const reposRouter = Router()
reposRouter.use(requireAuth, requireGithub)

reposRouter.get('/', async (req, res) => {
  try {
    const repos = await listUserRepos(req.user.github_access_token)
    res.json(repos)
  } catch (err) {
    sendGithubAwareError(res, err, 'No se pudo obtener la lista de repositorios de GitHub', 502)
  }
})

reposRouter.get('/:owner/:repo/tree', async (req, res) => {
  try {
    const tree = await getRepoTree(req.user.github_access_token, req.params.owner, req.params.repo)
    res.json(tree)
  } catch (err) {
    sendGithubAwareError(res, err, 'No se pudo leer el árbol del repositorio', 502)
  }
})

reposRouter.get('/:owner/:repo/file', async (req, res) => {
  const { path } = req.query
  if (!path) return res.status(400).json({ error: 'Falta el parámetro path' })
  try {
    const content = await getFileContent(req.user.github_access_token, req.params.owner, req.params.repo, path)
    res.json({ path, content })
  } catch (err) {
    sendGithubAwareError(res, err, 'No se pudo leer el archivo', 502)
  }
})
