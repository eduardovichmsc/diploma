/**
 * Демо-данные для разработки и защиты.
 * ВНИМАНИЕ: очищает все таблицы перед заполнением. Запускать только на dev-базе.
 *
 * Тестовые учётные записи (только для локальной разработки):
 *   admin@rental.local   / Admin12345!   — администратор платформы
 *   owner@rental.local   / Owner12345!   — владелец компании-арендодателя (ACTIVE)
 *   manager@rental.local / Manager12345! — менеджер той же компании
 *   pending@rental.local / Pending12345! — владелец компании на проверке (PENDING)
 *   renter@rental.local  / Renter12345!  — арендатор
 */
import {
  FuelType,
  MemberRole,
  PlatformRole,
  PrismaClient,
  ProviderStatus,
  ProviderType,
  Transmission,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function user(email: string, password: string, fullName: string, role: PlatformRole = PlatformRole.USER) {
  return prisma.user.create({
    data: { email, fullName, role, passwordHash: await bcrypt.hash(password, 10), phone: '+70000000000' },
  });
}

async function main() {
  // порядок важен из-за внешних ключей
  await prisma.$transaction([
    prisma.review.deleteMany(),
    prisma.rentalCharge.deleteMany(),
    prisma.telemetryPoint.deleteMany(),
    prisma.vehicleEvent.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.rental.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.dtcRecord.deleteMany(),
    prisma.device.deleteMany(),
    prisma.tariff.deleteMany(),
    prisma.vehicle.deleteMany(),
    prisma.geofence.deleteMany(),
    prisma.providerMember.deleteMany(),
    prisma.businessProfile.deleteMany(),
    prisma.individualProfile.deleteMany(),
    prisma.rentalProvider.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  await user('admin@rental.local', 'Admin12345!', 'Администратор платформы', PlatformRole.ADMIN);
  const owner = await user('owner@rental.local', 'Owner12345!', 'Пётр Владелец');
  const manager = await user('manager@rental.local', 'Manager12345!', 'Мария Менеджер');
  const pendingOwner = await user('pending@rental.local', 'Pending12345!', 'Олег Новичок');
  await user('renter@rental.local', 'Renter12345!', 'Иван Арендатор');

  const provider = await prisma.rentalProvider.create({
    data: {
      type: ProviderType.BUSINESS,
      status: ProviderStatus.ACTIVE,
      displayName: 'АвтоПрокат Плюс',
      rating: 4.8,
      business: {
        create: {
          legalName: 'ООО «АвтоПрокат Плюс»',
          taxId: '7701234567',
          legalAddress: 'г. Москва, ул. Примерная, д. 1',
          bankAccount: '40702810000000000001',
          contactEmail: 'info@autoprokat.local',
        },
      },
      members: {
        create: [
          { userId: owner.id, role: MemberRole.OWNER },
          { userId: manager.id, role: MemberRole.MANAGER },
        ],
      },
    },
  });

  await prisma.rentalProvider.create({
    data: {
      type: ProviderType.BUSINESS,
      status: ProviderStatus.PENDING,
      displayName: 'Городской Прокат',
      business: {
        create: {
          legalName: 'ООО «Городской Прокат»',
          taxId: '7709876543',
          legalAddress: 'г. Москва, пр-т Тестовый, д. 10',
          bankAccount: '40702810000000000002',
        },
      },
      members: { create: { userId: pendingOwner.id, role: MemberRole.OWNER } },
    },
  });

  const cars = [
    { brand: 'Toyota', model: 'Camry', year: 2022, plateNumber: 'А123ВС777', vin: 'JTNB11HK103456789', transmission: Transmission.AUTOMATIC, fuelType: FuelType.PETROL, seats: 5, day: 6500, hour: 900 },
    { brand: 'Hyundai', model: 'Solaris', year: 2021, plateNumber: 'В456ОР777', vin: 'Z94K241CBMR123456', transmission: Transmission.AUTOMATIC, fuelType: FuelType.PETROL, seats: 5, day: 3500, hour: 500 },
    { brand: 'Kia', model: 'Rio', year: 2023, plateNumber: 'Е789КХ777', vin: 'Z94C251ABPR654321', transmission: Transmission.MANUAL, fuelType: FuelType.PETROL, seats: 5, day: 3200, hour: 450 },
    { brand: 'Skoda', model: 'Octavia', year: 2020, plateNumber: 'М321ТУ777', vin: 'XW8AN2NE5LH112233', transmission: Transmission.AUTOMATIC, fuelType: FuelType.DIESEL, seats: 5, day: 4500, hour: 650 },
  ];

  const vehicles = [];
  for (const c of cars) {
    vehicles.push(
      await prisma.vehicle.create({
        data: {
          providerId: provider.id,
          brand: c.brand,
          model: c.model,
          year: c.year,
          plateNumber: c.plateNumber,
          vin: c.vin,
          transmission: c.transmission,
          fuelType: c.fuelType,
          seats: c.seats,
          city: 'Москва',
          description: `${c.brand} ${c.model} ${c.year}, оснащён телематическим модулем`,
          tariff: {
            create: {
              pricePerHour: c.hour,
              pricePerDay: c.day,
              kmLimitPerDay: 250,
              overmileagePrice: 15,
              fuelPricePerPercent: 60,
              deposit: 10000,
            },
          },
        },
      }),
    );
  }

  // Модули: SIM-0001 и SIM-0002 стоят на машинах, SIM-0003 на складе
  const secretHash = await bcrypt.hash('dev-device-secret', 10);
  await prisma.device.create({ data: { serial: 'SIM-0001', secretHash, firmwareVersion: '0.1.0', vehicleId: vehicles[0].id } });
  await prisma.device.create({ data: { serial: 'SIM-0002', secretHash, firmwareVersion: '0.1.0', vehicleId: vehicles[1].id } });
  await prisma.device.create({ data: { serial: 'SIM-0003', secretHash, firmwareVersion: '0.1.0' } });

  console.log('Сид-данные созданы:');
  console.log(`  арендодатель ${provider.displayName} (${provider.id}), машин: ${vehicles.length}`);
  console.log('  модули: SIM-0001 → Toyota Camry, SIM-0002 → Hyundai Solaris, SIM-0003 свободен');
  console.log('  учётные записи — в шапке prisma/seed.ts');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
