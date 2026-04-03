import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom"
import Header from "./components/Header"
import { SeasonProvider } from "./context/SeasonContext"
import StandingsPage from "./pages/StandingsPage"
import TeamsPage from "./pages/TeamsPage"
import TeamDetailPage from "./pages/TeamDetailPage"
import LeagueRulesPage from "./pages/LeagueRulesPage"
import DraftResultsPage from "./pages/DraftResultsPage"
import PlayerDetailPage from "./pages/PlayerDetailPage"
import HistoryPage from "./pages/HistoryPage"
import HomePage from "./pages/HomePage"
import ContractsPage from "./pages/ContractsPage"
import ThemeAwardsPage from "./pages/ThemeAwardsPage"


function PlaceholderPage({ title }) {
  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 20px" }}>
      <div
        style={{
          background: "#ffffff",
          border: "1px solid #fed7aa",
          borderRadius: 20,
          padding: 24,
        }}
      >
        <h2 style={{ margin: 0 }}>{title}</h2>
      </div>
    </main>
  )
}

export default function App() {
  return (
    <SeasonProvider>
      <BrowserRouter>
        <Header />
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/standings" element={<StandingsPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:teamSlug" element={<TeamDetailPage />} />
          <Route path="/draft-picks" element={<PlaceholderPage title="Draft Picks page" />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history" element={<PlaceholderPage title="History page" />} />
          <Route path="/league-rules" element={<LeagueRulesPage />} />
          <Route path="/draft-results" element={<DraftResultsPage />} />
          <Route path="/players/:playerSlug" element={<PlayerDetailPage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          <Route path="/war-room" element={<ThemeAwardsPage />} />
        </Routes>
      </BrowserRouter>
    </SeasonProvider>
  )
}