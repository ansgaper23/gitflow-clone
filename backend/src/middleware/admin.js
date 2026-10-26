export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Requiere permisos de administrador' })
  }
  next()
}

// Admin o colaborador: puede ver usuarios y activar/revocar planes, pero no gestionar
// las cuentas de IA (eso sigue exigiendo requireAdmin específicamente).
export function requireStaff(req, res, next) {
  if (!req.user?.is_admin && !req.user?.is_collaborator) {
    return res.status(403).json({ error: 'Requiere permisos de administrador o colaborador' })
  }
  next()
}
