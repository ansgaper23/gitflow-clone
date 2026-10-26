import { Navigate } from 'react-router-dom'
import Header from '../components/landing/Header.jsx'
import Hero from '../components/landing/Hero.jsx'
import HowItWorks from '../components/landing/HowItWorks.jsx'
import Pain from '../components/landing/Pain.jsx'
import Pricing from '../components/landing/Pricing.jsx'
import ResellerPromo from '../components/landing/ResellerPromo.jsx'
import Testimonials from '../components/landing/Testimonials.jsx'
import FAQ from '../components/landing/FAQ.jsx'
import CTA from '../components/landing/CTA.jsx'
import Footer from '../components/landing/Footer.jsx'
import { useAuth } from '../context/AuthContext.jsx'

export default function Landing() {
  const { user, loading } = useAuth()

  // Si ya hay sesión iniciada, el índice no tiene sentido mostrarlo (es la landing de
  // marketing) — va directo al dashboard, como cualquier app real.
  if (!loading && user) {
    return <Navigate to="/dashboard" replace />
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-b from-[#0b0c10] via-[#1b3b85] to-[#f21b83] text-white">
      <Header />
      <main className="flex flex-col">
        <Hero />
        <HowItWorks />
        <Pain />
        <Testimonials />
        <Pricing />
        <ResellerPromo />
        <FAQ />
        <CTA />
      </main>
      <Footer />
    </div>
  )
}
