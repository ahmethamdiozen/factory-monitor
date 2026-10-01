-- "Fabrikanın" SQL Server şeması. Simülatör yazar, collector sadece okur.
-- Tüm zamanlar UTC. Ölçüm/olay tabloları sadece ekleme (insert-only) + identity anahtar.
-- Şema sürümü dbo.SchemaInfo'dadır; simülatör sürüm değişince tabloları yeniden kurar.

IF OBJECT_ID('dbo.SchemaInfo') IS NULL
CREATE TABLE dbo.SchemaInfo (
  Version int NOT NULL
);
GO

IF OBJECT_ID('dbo.Lines') IS NULL
CREATE TABLE dbo.Lines (
  LineId      varchar(10)   NOT NULL PRIMARY KEY,
  LineName    nvarchar(100) NOT NULL
);
GO
IF OBJECT_ID('dbo.Machines') IS NULL
CREATE TABLE dbo.Machines (
  MachineId              varchar(10)   NOT NULL PRIMARY KEY,
  MachineCode            varchar(20)   NOT NULL,
  MachineName            nvarchar(100) NOT NULL,
  Model                  varchar(30)   NOT NULL,
  LineId                 varchar(10)   NOT NULL REFERENCES dbo.Lines(LineId),
  MachineType            varchar(20)   NOT NULL, -- cnc, grinder, furnace, coating, cmm
  PartNumber             nvarchar(30)  NOT NULL,
  PartName               nvarchar(100) NOT NULL,
  OperationNo            varchar(10)   NOT NULL,
  BatchSize              int           NOT NULL, -- bir çevrimdeki parça (fırın şarjı)
  IdealCycleTimeMs       int           NOT NULL, -- bir çevrimin (şarjın) ideal süresi
  DailyTarget            int           NOT NULL,
  ToolLifeCycles         int           NOT NULL,
  QualityCharacteristic  nvarchar(60)  NOT NULL,
  QualityUnit            nvarchar(10)  NOT NULL,
  Nominal                decimal(12,4) NOT NULL,
  Lsl                    decimal(12,4) NOT NULL,
  Usl                    decimal(12,4) NOT NULL,
  ProcessStdDev          decimal(12,4) NOT NULL
);
GO
IF OBJECT_ID('dbo.DowntimeReasons') IS NULL
CREATE TABLE dbo.DowntimeReasons (
  ReasonCode   int           NOT NULL PRIMARY KEY,
  Description  nvarchar(100) NOT NULL,
  Category     varchar(20)   NOT NULL,
  IsPlanned    bit           NOT NULL
);
GO
IF OBJECT_ID('dbo.Employees') IS NULL
CREATE TABLE dbo.Employees (
  EmployeeId  varchar(10)   NOT NULL PRIMARY KEY,
  FullName    nvarchar(100) NOT NULL,
  Role        varchar(20)   NOT NULL,
  HireDate    date          NOT NULL
);
GO
IF OBJECT_ID('dbo.ShiftDefinitions') IS NULL
CREATE TABLE dbo.ShiftDefinitions (
  ShiftCode  char(1)      NOT NULL PRIMARY KEY,
  ShiftName  nvarchar(40) NOT NULL,
  StartTime  time(0)      NOT NULL,
  EndTime    time(0)      NOT NULL
);
GO
IF OBJECT_ID('dbo.ShiftAssignments') IS NULL
CREATE TABLE dbo.ShiftAssignments (
  AssignmentId  int IDENTITY(1,1) NOT NULL PRIMARY KEY,
  WorkDate      date        NOT NULL,
  ShiftCode     char(1)     NOT NULL REFERENCES dbo.ShiftDefinitions(ShiftCode),
  LineId        varchar(10) NOT NULL REFERENCES dbo.Lines(LineId),
  MachineId     varchar(10) NULL REFERENCES dbo.Machines(MachineId),
  EmployeeId    varchar(10) NOT NULL REFERENCES dbo.Employees(EmployeeId),
  Role          varchar(20) NOT NULL,
  INDEX IX_ShiftAssignments_Date (WorkDate, ShiftCode)
);
GO
IF OBJECT_ID('dbo.WorkOrders') IS NULL
CREATE TABLE dbo.WorkOrders (
  WorkOrderNo  nvarchar(20)  NOT NULL PRIMARY KEY,
  MachineId    varchar(10)   NOT NULL REFERENCES dbo.Machines(MachineId),
  ProductName  nvarchar(100) NOT NULL,
  TargetQty    int           NOT NULL,
  Status       varchar(20)   NOT NULL
);
GO
IF OBJECT_ID('dbo.MachineEvents') IS NULL
CREATE TABLE dbo.MachineEvents (
  EventId       bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  MachineId     varchar(10)  NOT NULL,
  EventTimeUtc  datetime2(3) NOT NULL,
  StatusCode    tinyint      NOT NULL, -- 1 çalışıyor, 2 durdu, 3 bakım, 4 ayar
  ReasonCode    int          NULL,
  INDEX IX_MachineEvents_Time (MachineId, EventTimeUtc)
);
GO
IF OBJECT_ID('dbo.ProductionCounters') IS NULL
CREATE TABLE dbo.ProductionCounters (
  Id             bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  MachineId      varchar(10)  NOT NULL,
  SampleTimeUtc  datetime2(3) NOT NULL,
  TotalCount     int          NOT NULL, -- kümülatif, üretim günü başında sıfırlanır
  RejectCount    int          NOT NULL,
  INDEX IX_ProductionCounters_Time (MachineId, SampleTimeUtc)
);
GO
-- Tezgâh kontrolörü / MES bağlamı (10 sn'de bir)
IF OBJECT_ID('dbo.ProcessValues') IS NULL
CREATE TABLE dbo.ProcessValues (
  Id              bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  MachineId       varchar(10)  NOT NULL,
  SampleTimeUtc   datetime2(3) NOT NULL,
  CycleTimeMs     int          NOT NULL,
  ToolCycleCount  int          NOT NULL,
  MaterialLot     varchar(20)  NOT NULL,
  INDEX IX_ProcessValues_Time (MachineId, SampleTimeUtc)
);
GO
-- Historian: sensör etiketleri (makine tipine göre 1–7 etiket, 10 sn'de bir).
-- Kopuk sensörün satırı yazılmaz.
IF OBJECT_ID('dbo.ProcessTags') IS NULL
CREATE TABLE dbo.ProcessTags (
  Id             bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  MachineId      varchar(10)  NOT NULL,
  SampleTimeUtc  datetime2(3) NOT NULL,
  Tag            varchar(40)  NOT NULL,
  Value          float        NOT NULL,
  INDEX IX_ProcessTags_Time (MachineId, SampleTimeUtc)
);
GO
-- Etiket sözlüğü: birim, açıklama, ortak kanal eşlemesi ve devreye alma referansı
IF OBJECT_ID('dbo.MachineTags') IS NULL
CREATE TABLE dbo.MachineTags (
  MachineId    varchar(10)   NOT NULL REFERENCES dbo.Machines(MachineId),
  Tag          varchar(40)   NOT NULL,
  Channel      varchar(10)   NULL,     -- temp, vib, hf, load, cur, aux, feed
  RelativeTo   varchar(40)   NULL,     -- kanal = bu etiket − RelativeTo (fırın: set değerinden sapma)
  Unit         nvarchar(10)  NOT NULL,
  Description  nvarchar(100) NOT NULL,
  Baseline     float         NULL,     -- devreye alma referansı (sağlıklı makine)
  PRIMARY KEY (MachineId, Tag)
);
GO
IF OBJECT_ID('dbo.QualitySamples') IS NULL
CREATE TABLE dbo.QualitySamples (
  Id              bigint IDENTITY(1,1) NOT NULL PRIMARY KEY,
  MachineId       varchar(10)   NOT NULL,
  SampleTimeUtc   datetime2(3)  NOT NULL,
  Characteristic  nvarchar(60)  NOT NULL,
  SubgroupNo      int           NOT NULL,
  SampleIdx       tinyint       NOT NULL,
  Value           decimal(12,4) NOT NULL,
  Nominal         decimal(12,4) NOT NULL,
  Lsl             decimal(12,4) NOT NULL,
  Usl             decimal(12,4) NOT NULL
);
GO
