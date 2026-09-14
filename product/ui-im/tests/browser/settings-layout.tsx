/** Browser-only layout fixture; it exercises presentation without a Host or account connection. */
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { WorkspaceSettingsDialog } from '../../src/client/workspace/WorkspaceSettingsDialog.tsx'
import { InlineConfirm } from '../../src/client/InlineConfirm.tsx'
import css from '../../src/client/WorkspaceCards.module.css'
import '../../../../packages/client/ui-theme/src/styles/design-platform.css'

function Fixture() {
  const [open, setOpen] = useState(true)
  const [picking, setPicking] = useState(false)
  const [selected, setSelected] = useState<number>()
  const [confirm, setConfirm] = useState(false)
  const [result, setResult] = useState('')
  return <>
    <button onClick={() => { setOpen(true) }}>打开设置</button><output data-result>{result}</output>
    <WorkspaceSettingsDialog open={open} onClose={() => { setOpen(false) }} closeLabel="关闭" title="工作区设置">
      <section className={css.card}>
        <div className={css.title}>IM 接管</div><p className={css.intro}>命中规则的会话，新消息由本工作区的 Agent 配置处理。绑定 ≠ 启用。</p>
        <p className={css.hint}>浏览器布局 Fixture · 不连接账号或调用模型；用于验证窗口边界、内容滚动和关闭操作。</p>
        {[0, 1, 2].map(index => <div className={css.row} key={index}>
          <div className={css.main}><div className={css.name}>离线配置账号 · 群聊 · 指定 2</div>
            <p className={css.sub}>offline-group-{index}-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa，offline-group-{index}-b</p>
            <p className={css.hint}>停用后不回退到「全部」规则；删除绑定才会重新被覆盖。</p></div>
          <div className={css.acts}><Button size="sm">编辑规则</Button><Button size="sm">删除</Button><Switch checked={false} label="启用规则" onChange={() => {}} /></div>
        </div>)}
        <Button>添加规则</Button>
      </section>
      <section className={css.card}>
        <div className={css.title}>IM 通道模拟</div><p className={css.intro}>选择一个已配置的接管目标。这个页面只验证组件布局，不运行模拟。</p>
        {picking ? <>
          {Array.from({ length: 24 }, (_, index) => <button className={css.pickerRow} key={index} aria-pressed={selected === index} onClick={() => { setSelected(index) }}>目标 {index + 1} · 工作区配置</button>)}
          <div className={css.acts}><Button onClick={() => { setPicking(false) }}>取消选择</Button><Button disabled={selected === undefined} onClick={() => { setPicking(false); setResult(`已选目标 ${selected! + 1}`) }}>保存目标</Button></div>
        </> : <Button onClick={() => { setPicking(true) }}>选择测试目标</Button>}
        {confirm ? <InlineConfirm cancelLabel="取消清除" confirmLabel="确认清除" onCancel={() => { setConfirm(false) }} onConfirm={() => { setConfirm(false); setResult('已清除') }}>清除仅影响新实例；此页面没有运行任何实例。</InlineConfirm>
          : <Button onClick={() => { setConfirm(true) }}>清除目标</Button>}
      </section>
    </WorkspaceSettingsDialog>
  </>
}

createRoot(document.getElementById('root')!).render(<Fixture />)
