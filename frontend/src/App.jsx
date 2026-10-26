import { useEffect } from 'react'
import { Route, Routes, Navigate, useLocation, useParams } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Auth from './pages/Auth.jsx'
import AuthCallback from './pages/AuthCallback.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Chat from './pages/Chat.jsx'
import ChatLegacyRedirect from './pages/ChatLegacyRedirect.jsx'
import Account from './pages/Account.jsx'
import Preferences from './pages/Preferences.jsx'
import AdminLayout from './pages/admin/AdminLayout.jsx'
import AdminUsers from './pages/admin/AdminUsers.jsx'
import AdminPlans from './pages/admin/AdminPlans.jsx'
import AdminPayments from './pages/admin/AdminPayments.jsx'
import AdminAI from './pages/admin/AdminAI.jsx'
import AdminResellers from './pages/admin/AdminResellers.jsx'
import AdminSystem from './pages/admin/AdminSystem.jsx'
import Reseller from './pages/Reseller.jsx'
import InviteAccept from './pages/InviteAccept.jsx'
import Terms from './pages/Terms.jsx'
import Privacy from './pages/Privacy.jsx'
import ProtectedRoute from './components/ProtectedRoute.jsx'
import AdminRoute from './components/AdminRoute.jsx'
import GithubReauthBanner from './components/GithubReauthBanner.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import WhatsAppButton from './components/WhatsAppButton.jsx'
import NotFound from './pages/NotFound.jsx'




function RefRedirect() {
  const { code } = useParams()
  useEffect(() => {
    if (code) localStorage.setItem('flowpro_ref', code)
    window.location.replace('/auth')
  }, [code])
  return null
}

export default function App() {
  const location = useLocation()
  // El botón flotante de WhatsApp se oculta en /chat/*: ahí ya hay controles pegados a las
  // esquinas (preview, envío de mensaje) y se superpondría.
  const showWhatsApp = !location.pathname.startsWith('/chat/')
  return (
    <div className="min-h-screen bg-aurora">
      <GithubReauthBanner />
      {showWhatsApp && <WhatsAppButton />}
      {/* key=pathname: si una página se cae, navegar a otra (o volver a entrar a la misma vía
          el link del dashboard) desmonta el boundary y le da una page fresca en vez de quedar
          trabado mostrando el error viejo. */}
      <ErrorBoundary key={location.pathname}>
        <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/r/:code" element={<RefRedirect />} />
        <Route path="/terminos" element={<Terms />} />
        <Route path="/privacidad" element={<Privacy />} />
        <Route path="/invite/:token" element={<InviteAccept />} />
        <Route
          path="/reseller"
          element={
            <ProtectedRoute>
              <Reseller />
            </ProtectedRoute>
          }
        />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chat/:projectId"
          element={
            <ProtectedRoute>
              <Chat />
            </ProtectedRoute>
          }
        />
        {/* Enlaces viejos con forma /chat/:owner/:repo (de antes de proyectos virtuales):
            resuelve el repo a un projectId y redirige a la ruta nueva. */}
        <Route
          path="/chat/:owner/:repo"
          element={
            <ProtectedRoute>
              <ChatLegacyRedirect />
            </ProtectedRoute>
          }
        />
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <Account />
            </ProtectedRoute>
          }
        />
        <Route
          path="/preferencias"
          element={
            <ProtectedRoute>
              <Preferences />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout />
            </AdminRoute>
          }
        >
          <Route index element={<Navigate to="usuarios" replace />} />
          <Route path="usuarios" element={<AdminUsers />} />
          <Route path="precios" element={<AdminPlans />} />
          <Route path="ventas" element={<AdminPayments />} />
          <Route path="ia" element={<AdminAI />} />
          <Route path="resellers" element={<AdminResellers />} />
          <Route path="sistema" element={<AdminSystem />} />
        </Route>
        <Route path="*" element={<NotFound />} />
        </Routes>
      </ErrorBoundary>
    </div>
  )
}
