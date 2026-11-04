"""文档站各页正文（占位符由 build.py 替换）。"""

def steps(*items):
    lis = ''.join(f'<li><b>{t}</b>{d}</li>' for t, d in items)
    return f'<ol class="steps">{lis}</ol>'


PAGES = {}

# ── 概览 ──
PAGES['index.html'] = dict(
    title='概览', crumbs=[], toc=[],
    body='''
<h1>使用 LabelVLA 完成一次数据标注</h1>
<p class="lead">本套文档以 3 条 Episode 的示例数据集为例，走一遍从建任务到发布新版本的完整流程。每个章节一页，用左侧导航按顺序阅读；照着做一遍约 15 分钟。</p>
<p class="lead">示例数据集：<code>tutorial_demo_template</code> · 3 个相机 · 30 FPS<br>登录账号：管理员 <code>admin</code> / <code>admin123</code></p>

<h2>平台的流转方式</h2>
<p>每个标注任务按同一套节点执行，人工只介入中间两步：</p>
<table>
  <tr><th>节点</th><th>由谁执行</th><th>做什么</th></tr>
  <tr><td>预处理</td><td>系统</td><td>读取元数据，清点视频和 Parquet</td></tr>
  <tr><td>人工标注</td><td>标注负责人</td><td>在 Studio 划分片段、写描述、标目标框</td></tr>
  <tr><td>人工验收</td><td>审核负责人</td><td>播放视频，通过或打回</td></tr>
  <tr><td>程序质检</td><td>系统</td><td>逐条检查是否都标注了（或填写跳过原因）</td></tr>
  <tr><td>版本发布</td><td>系统</td><td>输出独立版本和文件校验摘要</td></tr>
</table>

<h2>阅读顺序</h2>
<p>「流程演示」先看一遍整体流程；「操作指南」六页按顺序做完一次标注；「参考」按需查阅。</p>
<div class="cards">
  <a class="card" href="demo.html"><b>流程演示</b><span>33 秒连续录屏，先看一遍整体流程</span></a>
  <a class="card" href="guide-login.html"><b>1. 登录与数据管理</b><span>登录、查看数据集和标注状态</span></a>
  <a class="card" href="guide-task.html"><b>2. 新建标注任务</b><span>选数据集、分配标注人和审核人</span></a>
  <a class="card" href="guide-studio.html"><b>3. 标注工作台</b><span>划片段、写描述、画目标框</span></a>
  <a class="card" href="guide-sam.html"><b>4. SAM 辅助分割</b><span>点一下目标，自动跟踪整段视频</span></a>
  <a class="card" href="guide-submit.html"><b>5. 保存与提交</b><span>把标注写回版本并交给审核</span></a>
  <a class="card" href="guide-release.html"><b>6. 审核与版本发布</b><span>视频质检、程序质检、发布新版本</span></a>
  <a class="card" href="faq.html"><b>常见问题</b><span>报错提示与处理办法</span></a>
</div>
''')

# ── 流程演示 ──
PAGES['demo.html'] = dict(
    title='流程演示',
    crumbs=[('概览', 'index.html')],
    toc=[('录屏', 'demo'), ('示例数据', 'data')],
    body='''
<h1>流程演示</h1>
<p class="lead">下面这段录屏没有剪辑：登录、建任务、划片段、SAM 分割、审核、发布依次进行，页面顶部的黑条会说明每一步在做什么。</p>

<div class="video">
  <video controls preload="metadata" playsinline poster="{{POSTER}}">
    <source src="{{VIDEO_MAIN}}" type="video/mp4">
    你的浏览器不支持 video 标签。
  </video>
  <div class="video-cap"><b>流程演示</b><span>33 秒 · 1280×768 · 无配音</span></div>
</div>

<h2 id="data">示例数据说明</h2>
<p>录屏使用的是 <code>tutorial_demo_template</code>：3 条 Episode、3 个相机、30 FPS，每条 20 秒。标注示例是「抓取食物 → 放到托盘 → 回到初始位」三个动作片段，以及被抓取的那个碗的目标框。</p>
<p>你自己的数据集只要符合 LeRobot v2.x / v3.0 目录结构，放进 <code>data/</code> 并「重新扫描」就能在数据管理里看到。</p>
''')

# ── 1. 登录 ──
PAGES['guide-login.html'] = dict(
    title='1. 登录与数据管理',
    crumbs=[('概览', 'index.html')],
    toc=[('登录', 'login'), ('数据管理', 'datasets'), ('标注状态', 'status')],
    body='''
<h1>1. 登录与数据管理</h1>
<p class="lead">管理员账号 <code>admin</code>，密码 <code>admin123</code>。如果是新部署、还没改过密码，初始密码是 <code>admin</code>，首次登录会要求改密；改过之后以实际密码为准。登录后默认进入「数据管理」。</p>

<h2 id="login">登录</h2>
''' + steps(
        ('打开平台', '浏览器访问 <code>http://服务器地址:8002/</code>，输入账号和密码。'),
        ('首次登录改密', '第一次登录会跳到修改密码界面，新密码至少 6 位。'),
        ('进入数据管理', '登录后默认落在「数据管理」。左侧菜单依次是数据看板、数据管理、任务管理、视频库、版本管理、质检管理、用户管理。'),
    ) + '''

<h2 id="datasets">查看数据集</h2>
<p>数据管理页列出全部数据集：条数、时长、容量、相机数和标注进度。名称后面的标签是机器人来源，用来区分不同本体采集的数据。</p>
<figure><img data-rel="images/03-datasets.jpg" src="../images/03-datasets.jpg" alt="数据管理"><figcaption>图 1　数据管理：名称后面的标签是机器人来源，右侧是标注进度</figcaption></figure>

<h2 id="status">确认数据状态</h2>
<p>点数据集名称进入 Episode 列表。每条数据显示时长、任务描述和当前标注状态，用来判断这条数据是还没人碰、正在标、待审核还是已通过。</p>
<figure><img data-rel="images/04-episodes.jpg" src="../images/04-episodes.jpg" alt="Episode 列表"><figcaption>图 2　Episode 列表：每条数据显示时长、任务描述和当前标注状态</figcaption></figure>
<p>「数据看板」用来看整体进度：标注状态分布、质检通过率、最近 30 天的增长趋势。需要向团队汇报进度时先看这里。</p>
''')

# ── 2. 新建任务 ──
PAGES['guide-task.html'] = dict(
    title='2. 新建标注任务',
    crumbs=[('概览', 'index.html')],
    toc=[('新建', 'create'), ('任务详情', 'detail')],
    body='''
<h1>2. 新建标注任务</h1>
<p class="lead">任务必须绑定一个真实数据集。创建时会自动在 <code>output/数据集名/数据集名vN</code> 建独立副本，之后所有标注只写副本，原始数据不动。</p>

<h2 id="create">新建任务</h2>
''' + steps(
        ('任务管理 → 新建任务', '填写任务名称，任务类型选「视频标注任务」。'),
        ('关联数据集', '选择要标注的数据集。要接着已有版本改，就在「起始版本」里选对应版本，否则从原始数据开始。'),
        ('分配负责人', '标注负责人只能保存自己的任务；审核负责人负责验收。两个人可以是同一账号，生产环境建议分开。'),
        ('写任务描述', '把标注要求写清楚，标注员打开任务就能看到。'),
    ) + '''
<figure><img data-rel="images/05-task-create.jpg" src="../images/05-task-create.jpg" alt="新建任务"><figcaption>图 3　新建任务：任务名、关联数据集、标注负责人、审核负责人</figcaption></figure>
<div class="note">创建后任务会自动执行「预处理」，然后停在「人工标注」等人处理，不会自动往下走。</div>

<h2 id="detail">任务详情与节点</h2>
<p>详情页上半部分是任务信息和当前进度；下半部分列出五个节点，展开可以看到执行时间、耗时和产出。标注节点上有「进入工作区」按钮。</p>
<figure><img data-rel="images/task-detail.jpg" src="../images/task-detail.jpg" alt="任务详情"><figcaption>图 4　任务详情：上半部分是任务信息和当前进度，下半部分是节点详情</figcaption></figure>
<div class="note"><b>流程走偏了怎么办：</b>管理员可以用「转回节点」把流程退回更早的节点重跑，需要填写原因，操作会记入执行事件</div>
''')

# ── 3. 工作台 ──
PAGES['guide-studio.html'] = dict(
    title='3. 标注工作台',
    crumbs=[('概览', 'index.html')],
    toc=[('进入工作区', 'enter'), ('界面分区', 'layout'), ('划分片段', 'segments'), ('描述与目标框', 'describe')],
    body='''
<h1>3. 标注工作台</h1>
<p class="lead">点「进入工作区」后首次加载会创建任务副本，稍等几秒。进入后先点「开始标注」，再点左侧「编辑」，片段轨道才能编辑。</p>

<h2 id="enter">进入工作区</h2>
''' + steps(
        ('进入工作区', '在任务详情页「人工标注」节点点「进入工作区」。'),
        ('开始标注', '右上角点「开始标注」，Episode 状态变成「标注中」。只有标注员或管理员能编辑。'),
        ('开启编辑', '左侧栏点「编辑」，下方出现可编辑的片段轨道。'),
    ) + '''

<h2 id="layout">界面分区</h2>
<figure><img data-rel="images/studio.jpg" src="../images/studio.jpg" alt="标注工作台"><figcaption>图 5　标注工作台：左侧 Episode、中间相机、下方时间轴、右侧标注面板</figcaption></figure>
<table>
  <tr><th>区域</th><th>用途</th></tr>
  <tr><td>Episode 列表</td><td>切换数据、搜索、开启编辑，也可逐条标记通过</td></tr>
  <tr><td>相机画面</td><td>多路视频同帧显示，可增删相机列</td></tr>
  <tr><td>曲线 / 原始数据</td><td>关节曲线和逐帧原始值，帮助判断动作边界</td></tr>
  <tr><td>时间轴</td><td>播放、逐帧、倍速、裁剪；下方是片段轨道</td></tr>
  <tr><td>标注面板</td><td>片段、结构化描述、目标框、SAM 入口、保存与提交</td></tr>
</table>

<h2 id="segments">划分动作片段</h2>
<p>一条 Episode 通常包含抓取、移动、放置几个动作。把每个动作划成独立片段，后面的描述和目标框都挂在片段上。</p>
''' + steps(
        ('点未标注区域', '在片段轨道的斜纹区点一下，弹出「子任务」对话框，填写名称，例如「抓取食物」「放到托盘」。'),
        ('拖两端调边界', '鼠标移到片段边缘出现白色拖拽把手，左右拖动调整起止帧；剩余的未标注区域会补成新的斜纹段，继续点它给下一段命名。'),
        ('可以反复调整', '片段可以多次拖拽，直到起止帧和视频里的动作对得上。'),
    ) + '''
<div class="note warn"><b>注意：</b>界面底部提示的 <kbd>Q</kbd> 起点、<kbd>R</kbd> 终点、<kbd>Enter</kbd> 新建片段快捷键在当前版本没有生效，请用鼠标点轨道和拖拽边界来划分。</div>

<h2 id="describe">写描述与画目标框</h2>
''' + steps(
        ('选中片段', '点一下轨道上的片段，右侧面板显示「当前 Subtask 片段」。'),
        ('填结构化描述', '技能 / 对象 / 目标 / 状语四个下拉框，既可选择也可直接输入新词后回车，会自动拼成描述句。'),
        ('画目标框', '在任一相机画面按住拖动即可画框。一个片段可以画多个框。'),
    ) + '''
<figure><img data-rel="images/09-annotation-panel.jpg" src="../images/09-annotation-panel.jpg" alt="标注面板"><figcaption>图 6　选中片段后的标注面板：片段、结构化描述、目标框、SAM 入口</figcaption></figure>
<div class="note tip"><b>建议：</b>只标关键物体（例如被拿取的那一个碗），比把所有物体都标上省时间，程序质检也更容易通过。</div>
''')

# ── 4. SAM ──
PAGES['guide-sam.html'] = dict(
    title='4. SAM 辅助分割',
    crumbs=[('概览', 'index.html')],
    toc=[('操作步骤', 'steps'), ('注意事项', 'caveat')],
    body='''
<h1>4. SAM 辅助分割</h1>
<p class="lead">SAM 点一下目标就能分割出轮廓，并沿整段视频逐帧跟踪，省去手工画每一帧。它由独立部署的推理服务提供；没有配置时按钮会出现，但点击后无法建立会话。</p>

<h2 id="steps">操作步骤</h2>
''' + steps(
        ('选中片段', '例如「抓取食物」。没有选中片段时，SAM 面板不会出现。'),
        ('点「SAM 点选分割」', '首次使用会上传当前 Episode 视频建立会话，面板显示「SAM 就绪」后即可点选。'),
        ('在目标上点一下', '画面出现蓝色轮廓和绿色圆点，表示可以继续加点修正；按住 <kbd>Shift</kbd> 点背景可以作为负点修正。'),
        ('点「传播跟踪」', '按钮上实时显示进度（例如 240/600 帧），结束后提示「已生成目标框：N 帧轨迹」。'),
        ('保存', '按 <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd> 或点右上角「保存」，轮廓在后台落盘，刷新后仍可查看。'),
    ) + '''
<figure><img data-rel="images/18-sam-ready.jpg" src="../images/18-sam-ready.jpg" alt="SAM 就绪"><figcaption>图 7　「SAM 点选分割」就绪：面板显示当前相机，可以开始在画面上点选</figcaption></figure>
<figure><img data-rel="images/19-sam-point.jpg" src="../images/19-sam-point.jpg" alt="SAM 点选结果"><figcaption>图 8　点选结果：蓝色区域是分割轮廓，右侧给出对象编号和框尺寸</figcaption></figure>

<h2 id="caveat">注意事项</h2>
<div class="note warn"><b>返回的框特别大：</b>说明没点中目标（模型把桌面、墙面当成了目标）。点「放弃对象」换个位置再点，或换到视野更完整的相机重试。</div>
<p>其他几点实测经验：</p>
<ul>
  <li>腕部相机视野窄、遮挡多，通常不如正面相机点得准。</li>
  <li>点选的那一帧已经出结果，但其他帧要等「传播跟踪」跑完才有轮廓，中途报「资源加载失败」属于正常现象。</li>
  <li>传播是整段视频一起算的，进度条跑完再切换帧查看。</li>
</ul>
''')

# ── 5. 保存提交 ──
PAGES['guide-submit.html'] = dict(
    title='5. 保存与提交',
    crumbs=[('概览', 'index.html')],
    toc=[('保存', 'save'), ('提交', 'submit'), ('文件位置', 'files')],
    body='''
<h1>5. 保存与提交</h1>
<p class="lead">标注工作分两层保存：单条 Episode 的标注保存，和把整个工作区写回任务版本。</p>

<h2 id="save">保存</h2>
''' + steps(
        ('保存当前 Episode', '右侧标注面板的「保存」，只保存当前这一条。'),
        ('保存修改', '顶部「保存修改」把工作区里所有改动（包括裁剪过的视频）写回任务版本，等到提示「已保存」。'),
    ) + '''

<h2 id="submit">提交审核</h2>
''' + steps(
        ('完成人工标注', '在任务详情页「人工标注」节点点「完成人工标注」，任务流转到「人工验收」。'),
        ('处理前置提示', '如果提示「请先在 Studio 点击保存修改」，回到工作区点「保存修改」，等「已保存」后再提交。'),
    ) + '''

<h2 id="files">文件位置</h2>
<table>
  <tr><th>内容</th><th>位置</th></tr>
  <tr><td>标注结果</td><td>版本目录下的 <code>segments/episode_XXXXXX.json</code></td></tr>
  <tr><td>任务版本</td><td><code>output/数据集名/数据集名vN</code></td></tr>
  <tr><td>平台数据库</td><td><code>data/.platform/platform.db</code></td></tr>
</table>
''')

# ── 6. 审核发布 ──
PAGES['guide-release.html'] = dict(
    title='6. 审核与版本发布',
    crumbs=[('概览', 'index.html')],
    toc=[('视频质检', 'qc'), ('程序质检', 'program'), ('版本记录', 'versions')],
    body='''
<h1>6. 审核与版本发布</h1>
<p class="lead">审核人打开同一个任务，看到的是只读副本，标注面板顶部只有「通过 / 打回」。</p>

<h2 id="qc">视频质检</h2>
''' + steps(
        ('查看视频质检', '审核人点「查看视频质检」进入工作区，播放视频检查片段边界、描述和目标框。'),
        ('通过或打回', '点「质检通过」确认视频；打回必须填写原因，任务退回标注节点。'),
        ('确认后自动发布', '视频质检通过后，系统自动执行程序质检和版本发布，任务状态变为「已完成」。'),
    ) + '''

<h2 id="program">程序质检</h2>
<p>程序质检逐条检查 Episode 是否都有标注。未标注的必须填写跳过原因，否则这个节点会失败，任务停在「程序质检」。</p>
<div class="note">任务失败时用「转回节点」退回「人工标注」，补完再提交，不需要新建任务。</div>

<h2 id="versions">版本记录</h2>
<p>在「版本管理」里按发布顺序查看每个版本：Episodes 数、大小、状态、校验摘要，可下载完整数据包。旧版本不会被覆盖。</p>
<table>
  <tr><th>版本</th><th>含义</th></tr>
  <tr><td>V1.0、V2.0 …</td><td>发布顺序，不代表采集顺序</td></tr>
  <tr><td>标注中</td><td>任务已建但还没发布，数据包不完整</td></tr>
  <tr><td>已发布</td><td>有完整数据包和校验摘要，可下载</td></tr>
</table>
''')

# ── 常见问题 ──
PAGES['faq.html'] = dict(
    title='常见问题', crumbs=[('概览', 'index.html')], toc=[],
    body='''
<h1>常见问题</h1>
<table>
  <tr><th>现象</th><th>处理</th></tr>
  <tr><td>提示「请先在 Studio 点击保存修改」</td><td>工作区还有未写回的改动：回到工作区点顶部「保存修改」，等「已保存」后再提交。</td></tr>
  <tr><td>右侧没有「SAM 点选分割」</td><td>需要先选中一个片段；只读的审核模式下也不会出现。</td></tr>
  <tr><td>SAM 返回很大的框</td><td>没点中目标：点「放弃对象」重新点，或换到视野更完整的相机。</td></tr>
  <tr><td>传播跟踪进度长时间不动</td><td>推理服务排队或显存不足，稍等或联系管理员重启 SAM 服务。</td></tr>
  <tr><td>提示「资源加载失败」</td><td>点选那一帧还没有轮廓，传播跟踪跑完后会正常。关掉弹窗继续操作即可。</td></tr>
  <tr><td>提示「标注已被其他会话修改」</td><td>同一条 Episode 被别处保存过：刷新页面重新加载后再改。</td></tr>
  <tr><td>程序质检不通过</td><td>多半还有 Episode 没标注：用「转回节点」退回标注节点，补完再提交。</td></tr>
  <tr><td>点「完成人工标注」没反应</td><td>任务必须先保存修改；确认本人是任务负责人或管理员。</td></tr>
  <tr><td>管理员密码忘了</td><td>默认是 <code>admin123</code>（首次部署未改密时为 <code>admin</code>）。都登录不了就让管理员在「用户管理」里重置，或联系部署方处理数据库。</td></tr>
</table>
''')

# ── 快捷键 ──
PAGES['shortcuts.html'] = dict(
    title='快捷键', crumbs=[('概览', 'index.html')], toc=[],
    body='''
<h1>快捷键</h1>
<table>
  <tr><th>按键</th><th>作用</th></tr>
  <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>S</kbd></td><td>保存当前 Episode 的标注</td></tr>
  <tr><td><kbd>Shift</kbd>+点击</td><td>SAM 模式下添加负点，修正分割轮廓</td></tr>
  <tr><td><kbd>Esc</kbd></td><td>退出 SAM 模式、关闭弹窗</td></tr>
  <tr><td><kbd>←</kbd> / <kbd>→</kbd></td><td>选中播放条后逐帧前后移动</td></tr>
</table>
<div class="note warn"><b>当前版本未生效：</b>界面底部提示的 <kbd>Q</kbd> 起点、<kbd>R</kbd> 终点、<kbd>Enter</kbd> 新建片段快捷键不能用，请用鼠标点轨道和拖拽边界。</div>
''')

# ── 角色 ──
PAGES['roles.html'] = dict(
    title='角色与权限', crumbs=[('概览', 'index.html')], toc=[],
    body='''
<h1>角色与权限</h1>
<p>管理员在「用户管理」里新建账号、调整角色、启用停用、绑定钉钉、查看登录记录。</p>
<table>
  <tr><th>角色</th><th>权限</th></tr>
  <tr><td>标注员</td><td>只能打开分配给自己的任务进行标注</td></tr>
  <tr><td>审核员</td><td>审核分配给自己的任务，通过或打回</td></tr>
  <tr><td>管理员</td><td>全部任务、数据集、用户与版本管理</td></tr>
</table>
<p>任务创建时指定标注负责人和审核负责人；同一任务两人可以是同一账号，生产环境建议分开，便于记录责任人。</p>
''')
