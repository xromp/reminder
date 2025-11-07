import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { LoggerService } from '../../common/utils/logger.service';
import { getMonth, getDate } from 'date-fns';

@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const { firstName, lastName, birthday, timezone } = createUserDto;

    // Extract birthday month and day for efficient indexing
    const birthdayMonth = getMonth(new Date(birthday)) + 1; // Months are 0-indexed
    const birthdayDay = getDate(new Date(birthday));

    const user = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        birthday: new Date(birthday),
        timezone,
        birthdayMonth,
        birthdayDay,
      },
    });

    this.logger.log('User created successfully', {
      userId: user.id,
      timezone,
      birthdayMonth,
      birthdayDay,
    });

    return user;
  }

  async findAll(includeDeleted = false) {
    return this.prisma.user.findMany({
      where: includeDeleted ? {} : { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user || user.deletedAt) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    // Verify user exists and is not deleted
    await this.findOne(id);

    const updateData: any = { ...updateUserDto };

    // Recalculate birthday month/day if birthday is updated
    if (updateUserDto.birthday) {
      updateData.birthday = new Date(updateUserDto.birthday);
      updateData.birthdayMonth = getMonth(updateData.birthday) + 1;
      updateData.birthdayDay = getDate(updateData.birthday);
    }

    const user = await this.prisma.user.update({
      where: { id },
      data: updateData,
    });

    this.logger.log('User updated successfully', {
      userId: id,
      updatedFields: Object.keys(updateUserDto),
    });

    return user;
  }

  async remove(id: string) {
    // Verify user exists
    await this.findOne(id);

    // Soft delete
    const user = await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    this.logger.log('User soft deleted', { userId: id });

    return user;
  }

  async hardDelete(id: string) {
    // Permanently delete user (admin operation)
    await this.prisma.user.delete({
      where: { id },
    });

    this.logger.warn('User permanently deleted', { userId: id });
  }

  // Find users with birthdays today for a specific timezone
  async findBirthdaysToday(timezone: string) {
    const today = new Date();
    const month = getMonth(today) + 1;
    const day = getDate(today);

    return this.prisma.user.findMany({
      where: {
        birthdayMonth: month,
        birthdayDay: day,
        timezone,
        deletedAt: null,
      },
    });
  }

  // Find all users with birthdays today across all timezones
  async findAllBirthdaysToday() {
    const today = new Date();
    const month = getMonth(today) + 1;
    const day = getDate(today);

    return this.prisma.user.findMany({
      where: {
        birthdayMonth: month,
        birthdayDay: day,
        deletedAt: null,
      },
    });
  }
}
