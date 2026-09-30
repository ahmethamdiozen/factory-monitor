import { HashRouter, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { EngineerLayout } from '@/components/layout/EngineerLayout'
import Overview from '@/pages/Overview'
import MachineDetail from '@/pages/MachineDetail'
import Losses from '@/pages/Losses'
import Quality from '@/pages/Quality'
import People from '@/pages/People'
import Events from '@/pages/Events'
import Guide from '@/pages/Guide'
import MachinePicker from '@/pages/operator/MachinePicker'
import OperatorScreen from '@/pages/operator/OperatorScreen'
import LinePicker from '@/pages/foreman/LinePicker'
import ForemanScreen from '@/pages/foreman/ForemanScreen'
import SqlData from '@/pages/SqlData'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route element={<EngineerLayout />}>
            <Route index element={<Overview />} />
            <Route path="makine/:id" element={<MachineDetail />} />
            <Route path="kayip" element={<Losses />} />
            <Route path="kalite" element={<Quality />} />
            <Route path="personel" element={<People />} />
            <Route path="olaylar" element={<Events />} />
            <Route path="metrikler" element={<Guide />} />
          </Route>
          <Route path="makine-ekrani" element={<MachinePicker />} />
          <Route path="makine-ekrani/:id" element={<OperatorScreen />} />
          <Route path="foreman" element={<LinePicker />} />
          <Route path="foreman/:lineId" element={<ForemanScreen />} />
          <Route path="sql" element={<SqlData />} />
          <Route path="*" element={<EngineerLayout />}>
            <Route path="*" element={<Overview />} />
          </Route>
        </Route>
      </Routes>
    </HashRouter>
  )
}
