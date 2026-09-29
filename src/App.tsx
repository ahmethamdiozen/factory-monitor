import { HashRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import Overview from '@/pages/Overview'
import MachineDetail from '@/pages/MachineDetail'
import Losses from '@/pages/Losses'
import Quality from '@/pages/Quality'
import People from '@/pages/People'
import Events from '@/pages/Events'
import Guide from '@/pages/Guide'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Overview />} />
          <Route path="makine/:id" element={<MachineDetail />} />
          <Route path="kayip" element={<Losses />} />
          <Route path="kalite" element={<Quality />} />
          <Route path="personel" element={<People />} />
          <Route path="olaylar" element={<Events />} />
          <Route path="metrikler" element={<Guide />} />
          <Route path="*" element={<Overview />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
